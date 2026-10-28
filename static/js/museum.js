// The museum page runtime: the boot loader, the welcome dialog, pointer lock, panels, history and deep links, the tour bar, and `window.Museum`, the only surface Godot calls through its WebBridge.
(function () {
	"use strict";

	// MARK: Constants
	// Status labels are padded with dots out to this column
	const STATUS_COLUMN = 35;

	// Status tags and their terminal colors, by level
	const TAGS = {
		ok: ["[ OK ]", "t-ok"],
		warn: ["[ -- ]", "t-warn"],
		err: ["[FAIL]", "t-err"]
	};

	// Seconds counted down before falling back to text mode
	const FALLBACK_SECONDS = 5;

	// How long the engine may run before reporting ready
	const READY_TIMEOUT_MS = 30000;

	// Pause between the last boot line and the welcome dialog
	const HANDOFF_MS = 700;

	// A status tag whose outcome is still coming, its dots revealed in turn by `shell.css`
	const PENDING_TAG = '<span class="t-hi">[<span class="pending">....</span>]</span>';

	// What an arrival is when Godot leaves it out, beside the Lobby's id and kind, where every visit arrives unless sent elsewhere
	const LOBBY_ARRIVAL = { title: "", panel: "", missing: false };

	// Every event of the press that retakes the pointer, in the order the browser sends them
	const RETURN_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];

	// The map's panel name, which belongs to no exhibit and never shows in the address
	const MAP = "map";

	// The namespace the visitor's mark is drawn into the map's plan with
	const SVG_NS = "http://www.w3.org/2000/svg";

	// The tour's paces, in turn, as multiples of its own speed
	const TOUR_PACES = [1, 2, 4];

	// MARK: Properties
	const el = {};
	let options = null;
	let entered = false;
	let failed = false;
	let isReady = false;
	let readyTimer = null;

	// The boot step on show whose outcome is still coming, settled by the next status
	let pending = null;

	// The group of boot steps on show, its `head` status, the `bar` its finished steps fill, and its latest `steps` listed above that bar
	let group = null;

	// Godot's callbacks, once it attaches
	let godot = {};

	// Where the deep link resolved to, from Godot
	let arrival = null;

	// The history entry on show: the travel point `at` and its `kind`, the open `panel` if any, and how many panel entries were pushed above the last travel (`depth`)
	let current = null;

	// Bumped on every panel change, so a slow fetch never shows a panel that was since closed
	let panelToken = 0;

	// What to do once an unwind's `popstate` lands
	let afterUnwind = null;

	// Whether the press now under way is retaking the pointer, and so belongs to the page
	let returning = false;

	// Whether Godot has been told to hold the visitor still for a panel
	let paused = false;

	// Whether the visitor is taking the tour, and what it has stopped to show (`id`, `artifact`, `title`), if anything
	let touring = false;
	let tourStop = null;

	// The tour's pace, kept for the visit
	let tourPace = TOUR_PACES[0];

	// Every panel fetched this visit, as a promise of its HTML by URL, so a prefetched panel opens at once
	const panelCache = new Map();

	// Images being warmed for prefetched panels, held until they load so they are not collected first
	const warming = new Set();

	// MARK: Private Functions
	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// Escape text for insertion as HTML
	function escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = String(text);
		return div.innerHTML;
	}

	// Append one line to the boot log, or put it before `before`, returning its element
	function print(html, before) {
		const line = document.createElement("span");
		line.innerHTML = html + "\n";
		el.log.insertBefore(line, before || null);
		el.boot.scrollTop = el.boot.scrollHeight;
		return line;
	}

	// Print a status line, inside the open group above its bar, keeping only the group's latest steps listed
	function printStep(html) {
		const line = print(html, group && group.bar);
		if (group) {
			group.steps.push(line);
			if (group.steps.length > options.groupWindow) {
				group.steps.shift().remove();
			}
		}
		return line;
	}

	// A status label, indented under the open group
	function stepLabel(text) {
		return group ? "  " + text : text;
	}

	// A label and dot leader, ready for a tag
	function statusLead(label) {
		return escapeHtml(label) + " " + ".".repeat(Math.max(3, STATUS_COLUMN - label.length)) + " ";
	}

	// A label, dot leader, and colored tag
	function statusLine(label, level, detail) {
		const [tag, cls] = TAGS[level] || TAGS.ok;
		const suffix = detail ? " " + escapeHtml(detail) : "";
		return statusLead(label) + '<span class="' + cls + '">' + tag + "</span>" + suffix;
	}

	// Print a status whose outcome is still coming, animated by CSS so it moves even while the engine blocks the page
	function pendingStatus(label) {
		const line = printStep(statusLead(label) + PENDING_TAG);
		return {
			label: label,
			finish: function (level, detail) {
				line.innerHTML = statusLine(label, level, detail) + "\n";
			}
		};
	}

	// Resolve once the page has painted, so a status shows before blocking work starts
	function nextPaint() {
		return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
	}

	// A text mode progress bar
	function bar(fraction, width) {
		const filled = Math.round(fraction * width);
		return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
	}

	// A progress line: the bar, its percentage, and what it counts
	function progressHtml(fraction, count) {
		const width = window.innerWidth < 760 ? 18 : 32;
		return '  <span class="t-hi">' + bar(fraction, width) + "</span> " + String(Math.round(fraction * 100)).padStart(3) + "%  " + count;
	}

	function megabytes(bytes) {
		return (bytes / (1024 * 1024)).toFixed(1);
	}

	// Count the memory test up to the device's reported memory, when the browser shares it
	async function memoryTest() {
		if (!navigator.deviceMemory) {
			return;
		}
		const total = navigator.deviceMemory * 1024 * 1024;
		const line = print('Memory test: <span>0</span>K OK');
		const count = line.querySelector("span");
		for (let i = 0; i <= 16; i++) {
			count.textContent = Math.round((total * i) / 16);
			await sleep(20);
		}
	}

	// Report a fatal problem, count down, then leave for text mode
	async function fail(reason) {
		if (failed) {
			return;
		}
		failed = true;
		clearTimeout(readyTimer);
		settleBoot("err");
		el.boot.classList.remove("done");
		el.welcome.hidden = true;

		// Explain, then count down with a way to go immediately
		print('  <span class="t-err">' + escapeHtml(reason) + "</span>");
		print("");
		print('<span class="t-warn">3D mode cannot start on this browser.</span>');
		const line = print('Switching to text mode in <span>' + FALLBACK_SECONDS + '</span>...  <a href="' + options.fallbackUrl + '">[ go now ]</a>');
		const count = line.querySelector("span");
		for (let n = FALLBACK_SECONDS; n >= 0; n--) {
			count.textContent = n;
			await sleep(1000);
		}
		window.location.href = options.fallbackUrl;
	}

	// Track download progress in place on one line, calling `onDone` once it completes
	function progressTracker(onDone) {
		const line = print("");
		let done = false;
		return function (current, total) {
			if (done) {
				return;
			}
			if (total > 0) {
				const fraction = Math.min(current / total, 1);
				line.innerHTML = progressHtml(fraction, megabytes(current) + "/" + megabytes(total) + " MB") + "\n";
				if (current >= total) {
					done = true;
					line.innerHTML = line.innerHTML.replace("\n", '  <span class="t-ok">[ OK ]</span>\n');
					onDone();
				}
			} else {
				line.innerHTML = "  " + megabytes(current) + " MB\n";
			}
		};
	}

	// Download, compile, and start the engine, giving each phase its own status
	async function bootEngine(engine) {
		// WARN: Mirrors `Engine.startGame` from Godot's `index.js` so each phase is visible; recheck it when upgrading Godot.
		const config = engine.config;
		const exe = config.executable;
		const pack = config.mainPack || exe + ".pck";
		config.args = ["--main-pack", pack].concat(config.args);

		// Download, then compile once the bytes are in
		let compiling = null;
		config.update({ onProgress: progressTracker(() => { compiling = pendingStatus("Compiling engine"); }) });
		await Promise.all([engine.init(exe), engine.preloadFile(pack, pack)]);
		(compiling || pendingStatus("Compiling engine")).finish("ok");

		// Show the start before it blocks the page, and keep it pending until Godot reports in
		pending = pendingStatus("Starting engine");
		await nextPaint();
		await engine.start();
	}

	// Settle the pending step, if any, once Godot reports again, readies, or the boot fails, counting it toward the open group's bar
	function settlePending(level, detail) {
		if (pending) {
			pending.finish(level, detail);
			pending = null;
			if (group) {
				group.done = Math.min(group.done + 1, group.total);
				drawGroup();
			}
		}
	}

	// Fill the open group's bar to its finished steps
	function drawGroup() {
		group.bar.innerHTML = progressHtml(group.done / group.total, group.done + "/" + group.total) + "\n";
	}

	// Close the open group, if any, settling its head
	function closeGroup(level, detail) {
		if (group) {
			group.head.finish(level, detail);
			group = null;
		}
	}

	// Settle whatever is still pending as the boot ends
	function settleBoot(level) {
		settlePending(level);
		closeGroup(level);
	}

	// Lock the pointer to the canvas, preferring raw mouse movement
	function lockPointer() {
		const request = el.canvas.requestPointerLock({ unadjustedMovement: true });
		if (request && request.catch) {
			request.catch(() => el.canvas.requestPointerLock());
		}
	}

	// Call one of Godot's callbacks, if it attached
	function callGodot(name, ...args) {
		if (godot[name]) {
			godot[name](...args);
		}
	}

	// The deep link in the page's address, or null
	function parseLink() {
		const params = new URLSearchParams(window.location.search);
		if (params.get(options.exhibitKind)) {
			return { kind: options.exhibitKind, id: params.get(options.exhibitKind), panel: params.get(options.panelQuery) || "" };
		}
		if (params.get(options.roomKind)) {
			return { kind: options.roomKind, id: params.get(options.roomKind), panel: "" };
		}
		return null;
	}

	// The address of a history entry: its exhibit panel, else the place its link named or its travel point, else the bare page
	function entryUrl(entry) {
		const params = new URLSearchParams();
		if (entry.panel && entry.panel.name !== MAP) {
			params.set(options.exhibitKind, entry.panel.id);
			params.set(options.panelQuery, entry.panel.name);
		} else if (entry.at !== options.lobby) {
			params.set(entry.kind, entry.link || entry.at);
		}
		const query = params.toString();
		return window.location.pathname + (query ? "?" + query : "");
	}

	// Where a panel is built to: the map, or one of an exhibit's, an artifact's in its own folder
	function panelUrl(panel) {
		if (panel.name === MAP) {
			return options.mapUrl;
		}
		const folder = options.panelsUrl + "/" + encodeURIComponent(panel.id) + "/";
		const artifact = panel.name.startsWith(options.artifactPanel) ? panel.name.slice(options.artifactPanel.length) : null;
		return folder + (artifact !== null ? options.artifactsDir + "/" + encodeURIComponent(artifact) : panel.name) + ".html";
	}

	// Push a history entry and show it
	function push(entry) {
		entry.depth = entry.panel ? current.depth + 1 : 0;
		history.pushState(entry, "", entryUrl(entry));
		show(entry);
	}

	// Bring the museum to a history entry: travel if its point differs, then show or hide its panel
	function show(entry) {
		const previous = current;
		current = entry;
		if (previous && entry.at !== previous.at) {
			callGodot("onTravel", entry.at);
		}
		if (entry.panel) {
			showPanel(entry.panel);
		} else {
			hidePanel();
		}
	}

	// Tell Godot to hold the visitor still, or to hand control back, only when that changes
	function pauseGodot(pause) {
		if (paused !== pause) {
			paused = pause;
			callGodot(pause ? "onPanelOpened" : "onPanelClosed");
		}
	}

	// A panel's HTML, from this visit's cache or fetched into it; a failed fetch is forgotten so it can be tried again
	function fetchPanel(panel) {
		const url = panelUrl(panel);
		if (!panelCache.has(url)) {
			const request = fetch(url).then((response) => {
				if (!response.ok) {
					throw new Error(response.status + " " + response.statusText);
				}
				return response.text();
			});
			request.catch(() => panelCache.delete(url));
			panelCache.set(url, request);
		}
		return panelCache.get(url);
	}

	// Start loading a panel's images, choosing the same sizes the panel will
	function warmImages(html) {
		const template = document.createElement("template");
		template.innerHTML = html;
		// WARN: Read the raw attributes; URLs inside a template resolve against its inert document, not this page.
		for (const img of template.content.querySelectorAll("img")) {
			const warm = new Image();
			warm.sizes = img.getAttribute("sizes") || "";
			warm.srcset = img.getAttribute("srcset") || "";
			warm.src = img.getAttribute("src");
			warming.add(warm);
			warm.onload = warm.onerror = () => warming.delete(warm);
		}
	}

	// Drop each panel image's blur-up placeholder once the image has loaded, so a transparent image never shows it through
	function settleImages() {
		for (const img of el.overlay.querySelectorAll("img.blur-up")) {
			if (img.complete) {
				img.classList.add("loaded");
			} else {
				img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
			}
		}
	}

	// Fetch a panel and show it over the museum, holding the visitor still with the loading ring in the crosshair's place until it arrives
	async function showPanel(panel) {
		const token = ++panelToken;
		if (el.overlay.hidden) {
			el.throbber.hidden = false;
			pauseGodot(true);
		}
		let html;
		try {
			html = await fetchPanel(panel);
		} catch (err) {
			// Drop a panel that cannot load, staying where the visitor is
			console.warn("Panel " + panel.id + "/" + panel.name + " did not load: " + (err instanceof Error ? err.message : err));
			if (token === panelToken) {
				current = Object.assign({}, current, { panel: null });
				history.replaceState(current, "", entryUrl(current));
				hidePanel();
			}
			return;
		}
		if (token !== panelToken) {
			return;
		}

		// Show it, releasing the pointer as the overlay first opens
		el.throbber.hidden = true;
		el.overlay.innerHTML = html;
		settleImages();
		if (el.overlay.hidden) {
			el.overlay.hidden = false;
			if (document.pointerLockElement) {
				document.exitPointerLock();
			}
		}
		updateResumeHint();

		// Offer a step back only to a panel under this one
		const back = el.overlay.querySelector("[data-back]");
		if (back) {
			back.hidden = current.depth <= 1;
		}
		const close = el.overlay.querySelector(".close");
		if (close) {
			close.focus();
		}
		if (panel.name === MAP) {
			markVisitor(panel.here);
		}
	}

	// Mark where the visitor stands on the map, facing `yaw` radians from north, with the plan's own arrow, then open the plan's pan and zoom view centered on them
	function markVisitor(here) {
		const plan = el.overlay.querySelector("svg[data-bands]");
		const bands = JSON.parse(plan.dataset.bands);
		const floor = String(here.floor) in bands ? here.floor : 0;
		const at = { x: parseFloat(plan.dataset.originX) + here.x, y: bands[floor] + here.z };
		if (floor === here.floor) {
			const arrow = document.createElementNS(SVG_NS, "polygon");
			arrow.setAttribute("class", "here");
			arrow.setAttribute("points", plan.dataset.hereArrow);
			arrow.setAttribute("transform", "translate(" + at.x + " " + at.y + ") rotate(" + (-here.yaw * 180 / Math.PI) + ")");
			plan.appendChild(arrow);
		}
		MapView(plan.closest(".map-view"), (id) => {
			lockPointer();
			travel(id, options.roomKind);
		}, at);
	}

	// Hide the overlay, or the loading ring, handing control back to Godot
	function hidePanel() {
		panelToken++;
		el.throbber.hidden = true;
		if (!el.overlay.hidden) {
			el.overlay.hidden = true;
			el.overlay.innerHTML = "";
			el.canvas.focus();
		}
		updateResumeHint();
		pauseGodot(false);
	}

	// Go back past every panel entry above the last travel point, then run `then`, so history only ever holds panels on top of the travel point they opened at
	function unwind(then) {
		if (current.depth > 0) {
			afterUnwind = then;
			history.go(-current.depth);
		} else {
			then();
		}
	}

	// Close the overlay, unwinding its entries so Back afterward returns to the previous travel point, then run `then` if given
	function closePanel(then) {
		unwind(() => {
			current = Object.assign({}, current, { panel: null });
			history.replaceState(current, "", entryUrl(current));
			hidePanel();
			if (then) {
				then();
			}
		});
	}

	// Take the tour from the Lobby, leaving the pointer free for the tour bar; Godot stops any attract loop first
	function startTour() {
		callGodot("onTour", true);
		if (tourPace !== TOUR_PACES[0]) {
			callGodot("onTourPace", tourPace);
		}
		touring = true;
		tourStop = null;
		showCaption("");
		el.tourStop.hidden = true;
		el.tourBar.hidden = false;
		el.canvas.focus();
		updateResumeHint();
	}

	// Caption the tour bar, the whole title on hover when it is cut
	function showCaption(title) {
		el.tourTitle.textContent = title;
		el.tourTitle.title = title;
	}

	// Step the tour to its next pace, around to the first
	function cyclePace() {
		tourPace = TOUR_PACES[(TOUR_PACES.indexOf(tourPace) + 1) % TOUR_PACES.length];
		el.tourPace.textContent = tourPace + "\u00d7";
		callGodot("onTourPace", tourPace);
	}

	// Put the tour bar away once the tour is over, however it ended, and give the keyboard back to the museum
	// WARN: Godot hears keys only while its canvas has focus, and a click on the tour bar's buttons takes it away.
	function endTour() {
		touring = false;
		tourStop = null;
		el.tourBar.hidden = true;
		el.canvas.focus();
		updateResumeHint();
	}

	// Leave the tour where it stands, retaking the pointer when `lock`, as the gesture allows
	function leaveTour(lock) {
		if (!touring) {
			return;
		}
		endTour();
		callGodot("onTour", false);
		if (lock) {
			lockPointer();
		}
	}

	// Stop the tour at what it shows and open its plaque there
	function stopHere() {
		const stop = tourStop;
		leaveTour(false);
		const at = stop.artifact ? options.artifactSpawn.replace("{exhibit}", stop.id).replace("{artifact}", stop.artifact) : stop.id;
		push({ at: at, link: stop.id, kind: options.exhibitKind, panel: null });
		push({ at: at, link: stop.id, kind: options.exhibitKind, panel: { id: stop.id, name: stop.artifact ? options.artifactPanel + stop.artifact : options.plaquePanel } });
	}

	// Travel to an exhibit or room, leaving any open panels behind
	function travel(id, kind) {
		unwind(() => push({ at: id, kind: kind, panel: null }));
	}

	// Handle the clicks inside a panel: close, step back to the panel under it, open the exhibit's page, travel to another exhibit or a wing, or take the tour; the map picks its own rooms
	function onOverlayClick(event) {
		const target = event.target.closest(".close, [data-back], a[data-panel], a[data-exhibit], a[data-room], [data-tour]");
		if (!target) {
			return;
		}
		event.preventDefault();

		// Retake the pointer inside the click, the gesture the browser requires
		if (target.matches(".close")) {
			lockPointer();
			closePanel();
		} else if (target.matches("[data-back]")) {
			history.back();
		} else if (target.matches("[data-tour]")) {
			closePanel(startTour);
		} else if (target.dataset.panel) {
			push({ at: current.at, kind: current.kind, panel: { id: current.panel.id, name: target.dataset.panel } });
		} else if (target.dataset.room) {
			lockPointer();
			travel(target.dataset.room, options.roomKind);
		} else {
			lockPointer();
			travel(target.dataset.exhibit, options.exhibitKind);
		}
	}

	// Any key leaves the tour, retaking the pointer unless it is Esc, which browsers refuse to lock on; Esc closes the overlay, as does the map key on the map, and with the pointer already free the visitor clicks to return
	function onKeyDown(event) {
		if (touring && el.overlay.hidden) {
			leaveTour(event.key !== "Escape");
			return;
		}
		const onMap = current && current.panel && current.panel.name === MAP;
		if (!el.overlay.hidden && (event.key === "Escape" || (onMap && event.key.toLowerCase() === "m"))) {
			closePanel();
		}
	}

	function onPopState(event) {
		if (!entered || !event.state) {
			return;
		}
		show(event.state);

		// Finish whatever was waiting for an unwind
		const then = afterUnwind;
		afterUnwind = null;
		if (then) {
			then();
		}
	}

	// Leave the welcome dialog for the museum, stopping the attract loop behind it
	function arrive() {
		entered = true;
		el.welcome.hidden = true;
		el.canvas.focus();
		callGodot("onTour", false);
	}

	// Take the tour from the welcome dialog, from the Lobby wherever the link pointed
	function enterTour() {
		arrive();
		current = { at: options.lobby, kind: options.roomKind, panel: null, depth: 0 };
		history.replaceState(current, "", entryUrl(current));
		startTour();
	}

	// Enter the museum from the welcome dialog's click, traveling to the deep link's target and opening its panel
	function enter() {
		arrive();
		// Travel to where Godot resolved the link, which for an artifact's panel is the artifact, while the address keeps naming the exhibit
		const at = arrival.at || arrival.id;
		current = { at: at, link: arrival.id, kind: arrival.kind, panel: null, depth: 0 };
		history.replaceState(current, "", entryUrl(current));
		if (at !== options.lobby) {
			callGodot("onTravel", at);
		}
		if (arrival.panel) {
			push({ at: at, link: arrival.id, kind: arrival.kind, panel: { id: arrival.id, name: arrival.panel } });
		} else {
			lockPointer();
		}
	}

	// Show the resume hint only while the museum is in view without the pointer
	function updateResumeHint() {
		if (entered) {
			el.resume.hidden = touring || document.pointerLockElement === el.canvas || !el.overlay.hidden;
		}
	}

	function onPointerLockChange() {
		updateResumeHint();
	}

	// Retake the pointer with a press on the canvas, leaving the tour if it is running, keeping that press and its release from Godot so returning never interacts
	// WARN: Godot listens on the canvas, so this must run in the window's capture phase, before any of its listeners.
	function onReturnPress(event) {
		if (event.type === "pointerdown" && entered && event.target === el.canvas && el.overlay.hidden && (touring || document.pointerLockElement !== el.canvas)) {
			returning = true;
			if (touring) {
				leaveTour(true);
			} else {
				lockPointer();
			}
		}
		if (!returning) {
			return;
		}
		event.stopImmediatePropagation();
		event.preventDefault();

		// Stop once the release and its click have passed; the click may not come at all
		if (event.type === "pointerup") {
			setTimeout(() => { returning = false; }, 0);
		}
	}

	// MARK: Functions
	window.Museum = {
		// Run the boot loader and start `engine`
		start: async function (engine, bootOptions) {
			// Merge in the build details `build.js` set, and arrive at the Lobby until Godot says otherwise
			options = Object.assign({}, bootOptions, window.MUSEUM_BUILD || {});
			arrival = Object.assign({ id: options.lobby, kind: options.roomKind }, LOBBY_ARRIVAL);
			el.canvas = document.getElementById("canvas");
			el.boot = document.getElementById("boot");
			el.log = document.getElementById("bootLog");
			el.welcome = document.getElementById("welcome");
			el.welcomeTitle = document.getElementById("welcomeTitle");
			el.overlay = document.getElementById("overlay");
			el.throbber = document.getElementById("throbber");
			el.resume = document.getElementById("resume");
			el.tourBar = document.getElementById("tourBar");
			el.tourTitle = document.getElementById("tourTitle");
			el.tourStop = document.getElementById("tourStop");
			el.tourPace = document.getElementById("tourPace");
			el.tourPace.addEventListener("click", cyclePace);
			document.getElementById("enter").addEventListener("click", enter);
			const takeTour = document.getElementById("takeTour");
			if (takeTour) {
				takeTour.addEventListener("click", enterTour);
			}
			el.tourStop.addEventListener("click", stopHere);
			document.getElementById("tourLeave").addEventListener("click", () => leaveTour(true));
			document.addEventListener("pointerlockchange", onPointerLockChange);
			document.addEventListener("keydown", onKeyDown);
			window.addEventListener("popstate", onPopState);
			for (const type of RETURN_EVENTS) {
				window.addEventListener(type, onReturnPress, true);
			}
			el.overlay.addEventListener("click", onOverlayClick);

			// Header
			print('<span class="t-hi">MUSEUM BIOS</span> v' + escapeHtml(options.version) + "   (C) " + escapeHtml(options.year) + " " + escapeHtml(options.title));
			print("Build " + escapeHtml(options.commit) + "  " + escapeHtml(options.date));
			print("");
			await memoryTest();
			print("");

			// Feature checks
			if (!Engine.isWebGLAvailable()) {
				print(statusLine("Detecting display adapter", "err"));
				fail("WebGL 2 is unavailable (context creation returned null).");
				return;
			}
			print(statusLine("Detecting display adapter", "ok", "WebGL 2.0"));
			const missing = Engine.getMissingFeatures({ threads: false });
			if (missing.length) {
				print(statusLine("Checking browser features", "err"));
				fail("Missing: " + missing.join(", "));
				return;
			}
			print(statusLine("Checking browser features", "ok"));
			print("  threads not required, no COOP/COEP needed");
			print(statusLine("Pointer lock", "requestPointerLock" in el.canvas ? "ok" : "warn"));
			print(statusLine("Touch input", navigator.maxTouchPoints > 0 ? "warn" : "ok", navigator.maxTouchPoints > 0 ? "touch screen detected" : "desktop mode"));
			print("");

			// Download and start the engine; Godot reports the rest
			print("Fetching museum (" + escapeHtml(options.executable) + ")");
			try {
				await bootEngine(engine);
			} catch (err) {
				fail(err instanceof Error ? err.message : String(err));
				return;
			}
			// WARN: Godot may report ready while `startGame` is still resolving, so only arm the watchdog if it has not.
			if (!isReady) {
				readyTimer = setTimeout(() => fail("The museum did not finish loading."), READY_TIMEOUT_MS);
			}
		},

		// Report a real boot status from Godot, `level` being ok, warn, or err, with an optional `detail` after the tag, settling the pending step or closing the open group in place when it names it
		bootStatus: function (text, level, detail) {
			if (group && text === group.head.label) {
				settlePending("ok");
				closeGroup(level || "ok", detail);
			} else if (pending && pending.label === stepLabel(text)) {
				settlePending(level || "ok", detail);
			} else {
				settlePending("ok");
				printStep(statusLine(stepLabel(text), level || "ok", detail));
			}
		},

		// Show a boot step from Godot whose outcome is still coming, before work that blocks the page; with `steps`, open a group of that many steps listed under it above one bar
		bootPending: function (text, steps) {
			settlePending("ok");
			if (steps > 0 && !group) {
				const head = pendingStatus(text);
				group = { head: head, bar: print(""), steps: [], done: 0, total: steps };
				drawGroup();
			} else {
				pending = pendingStatus(stepLabel(text));
			}
		},

		// Hand over Godot's callbacks for the page's requests
		attach: function (onPanelOpened, onPanelClosed, onTravel, onTour, onTourPace) {
			godot = { onPanelOpened, onPanelClosed, onTravel, onTour, onTourPace };
		},

		// The deep link the page was opened with, as JSON for Godot to resolve
		deepLink: function () {
			return JSON.stringify(parseLink());
		},

		// Finish the boot loader and show the welcome dialog, headed with where the visitor was sent; `arrivalJson` is Godot's resolution of the deep link
		ready: async function (arrivalJson) {
			if (failed || isReady) {
				return;
			}
			isReady = true;
			clearTimeout(readyTimer);
			settleBoot("ok");
			arrival = Object.assign({ id: options.lobby, kind: options.roomKind }, LOBBY_ARRIVAL, arrivalJson ? JSON.parse(arrivalJson) : {});
			if (arrival.missing) {
				el.welcomeTitle.textContent = "Lobby · That link's destination is gone";
			} else if (arrival.id !== options.lobby) {
				el.welcomeTitle.textContent = "You have been sent to: " + arrival.title;
			}
			print("");
			print('<span class="t-hi">READY.</span> Entering the museum...');
			await sleep(HANDOFF_MS);
			el.boot.classList.add("done");
			el.welcome.hidden = false;
		},

		// Show an exhibit's `panel` (plaque, page, or artifact/<id>) over the museum, as a history entry
		openPanel: function (id, panel) {
			if (entered) {
				push({ at: current.at, kind: current.kind, panel: { id: id, name: panel } });
			}
		},

		// Fetch an exhibit's `panel` and warm its images ahead of a press, as the visitor aims at it
		prefetchPanel: function (id, panel) {
			fetchPanel({ id: id, name: panel }).then(warmImages, () => {});
		},

		// Show the museum map with the visitor marked on `floor` at `x` and `z` meters, facing `yaw` radians from north, as a history entry
		openMap: function (floor, x, z, yaw) {
			if (entered) {
				push({ at: current.at, kind: current.kind, panel: { id: "", name: MAP, here: { floor: floor, x: x, z: z, yaw: yaw } } });
			}
		},

		// Caption what the tour has stopped to show, offering to stop there; `stopJson` is empty while it glides
		tourAt: function (stopJson) {
			if (!touring) {
				return;
			}
			const stop = JSON.parse(stopJson || "{}");
			tourStop = stop.id ? stop : null;
			showCaption(tourStop ? tourStop.title : "");
			el.tourStop.hidden = !tourStop;
		},

		// The tour ended in Godot, at its end or by a travel, with the visitor in control
		tourEnded: function () {
			if (touring) {
				endTour();
			}
		},

		// Leave for the text mode site, whatever the museum is doing
		textMode: function () {
			window.location.href = options.textModeUrl;
		}
	};
})();
