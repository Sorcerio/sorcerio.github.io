// The text mode prompt: a DOS-style command line over the page's real links, added only when scripting runs, so every page still works without it.
(function () {
	"use strict";

	// MARK: Constants
	const PROMPT = "C:\\MUSEUM&gt; ";

	const HELP =
		'<span class="t-hi">COMMANDS</span>\n' +
		'  <span class="t-cyan">1..99</span>       follow the numbered link\n' +
		'  <span class="t-cyan">dir</span>         list all exhibits\n' +
		'  <span class="t-cyan">open</span> NAME   open an exhibit (e.g. open web4)\n' +
		'  <span class="t-cyan">back</span>        previous page\n' +
		'  <span class="t-cyan">enter</span>       start the 3D museum here\n' +
		'  <span class="t-cyan">licenses</span>    show the licenses\n' +
		'%RESUME%' +
		'  <span class="t-cyan">cls</span>         clear the screen\n' +
		'  <span class="t-cyan">help</span>        this list\n';

	// The help line for the resume, offered only with a front desk
	const HELP_RESUME = '  <span class="t-cyan">resume</span>      show the resume\n';

	// What a page arriving with `?fallback` says, since the boot loader sent it here
	const FALLBACK_NOTE = '<span class="t-warn">[NOTE]</span> The 3D museum needs WebGL 2, which this browser could not start.\n';

	// MARK: Properties
	const el = {};
	let siteRoot = "";
	let pages = [];

	// What the HTML step hands the prompt: the queries it reads, and the pages its commands and forwarded deep links go to from the site root, the resume's only with a front desk
	let config = {};

	// MARK: Private Functions
	// Escape text for insertion as HTML
	function escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = String(text);
		return div.innerHTML;
	}

	// Append HTML to the session
	function print(html) {
		el.out.insertAdjacentHTML("beforeend", html);
	}

	// The page's numbered links, in order
	function links() {
		return Array.from(document.querySelectorAll("a.term-link"));
	}

	// Follow a link the way clicking it would; a download is clicked, since following it would open the file instead
	function follow(link) {
		if (link.hasAttribute("download")) {
			link.click();
		} else if (link.target === "_blank") {
			window.open(link.href, "_blank", "noopener");
		} else {
			window.location.href = link.href;
		}
	}

	// Follow the page's link for a command, or go to `fallback` from the site root
	function followCommand(cmd, fallback) {
		const link = document.querySelector('a.term-link[data-cmd="' + cmd + '"]');
		if (link) {
			follow(link);
		} else {
			window.location.href = siteRoot + fallback;
		}
	}

	// Run one typed command
	function run(raw) {
		const cmd = raw.trim().toLowerCase();
		if (!cmd) {
			return;
		}

		// Follow a numbered link
		if (/^\d+$/.test(cmd)) {
			const link = links()[Number(cmd) - 1];
			if (link) {
				follow(link);
			} else {
				print('<span class="t-err">No such option</span>\n\n');
			}
			return;
		}

		const [verb, arg] = cmd.split(/\s+/, 2);
		if (verb === "help" || verb === "?") {
			print(HELP.replace("%RESUME%", config.resumeUrl ? HELP_RESUME : "") + "\n");
		} else if (verb === "dir" || verb === "ls") {
			followCommand("dir", config.exhibitsUrl);
		} else if (verb === "open" || verb === "cd" || verb === "type") {
			if (pages.includes(arg)) {
				window.location.href = siteRoot + config.exhibitsUrl + arg + "/";
			} else {
				print('<span class="t-err">File not found</span>' + (arg ? ": " + escapeHtml(arg) : "") + ". Type <span class=\"t-hi\">dir</span> for the list.\n\n");
			}
		} else if (verb === "back") {
			if (window.history.length > 1) {
				window.history.back();
			} else {
				print("Already at the first page.\n\n");
			}
		} else if (verb === "enter") {
			followCommand("enter", "");
		} else if (verb === "licenses") {
			followCommand("licenses", config.licensesUrl);
		} else if (verb === "resume" && config.resumeUrl) {
			followCommand("resume", config.resumeUrl);
		} else if (verb === "cls" || verb === "clear") {
			el.out.innerHTML = "";
		} else {
			print('<span class="t-err">Bad command or file name</span>. Type <span class="t-hi">help</span>.\n\n');
		}
	}

	function onKeyDown(event) {
		if (event.key === "Enter") {
			const value = el.input.value;
			el.input.value = "";
			print(PROMPT + escapeHtml(value) + "\n");
			run(value);
			el.input.scrollIntoView({ block: "nearest" });
		}
	}

	// Clicking empty space focuses the prompt, without stealing a text selection
	function onMouseUp(event) {
		if (!window.getSelection().toString() && !event.target.closest("a, button, input")) {
			el.input.focus({ preventScroll: true });
		}
	}

	// Send a shell address that asked for text mode to its page: the page a panel forwards to, such as the Lobby's licenses, or the page of the exhibit, the Atrium, or the front desk it names; anything else stays on this list
	function forwardDos() {
		const params = new URLSearchParams(window.location.search);
		if (!Array.from(params.keys()).some((key) => key.toLowerCase() === config.dosFlag)) {
			return false;
		}
		const id = params.get(config.exhibitQuery);
		const forward = (config.forwards[id] || {})[params.get(config.panelQuery)];
		if (forward) {
			window.location.replace(siteRoot + forward);
		} else if (pages.includes(id)) {
			window.location.replace(siteRoot + config.exhibitsUrl + id + "/");
		} else {
			return false;
		}
		return true;
	}

	// MARK: Lifecycle
	el.out = document.getElementById("termOut");
	el.input = document.getElementById("termInput");
	siteRoot = document.body.dataset.siteRoot || "";
	pages = JSON.parse(document.body.dataset.pages || "[]");
	config = JSON.parse(document.body.dataset.config || "{}");
	if (forwardDos()) {
		return;
	}
	el.input.addEventListener("keydown", onKeyDown);
	document.addEventListener("mouseup", onMouseUp);

	// Show the prompt, which only exists when scripting does
	document.getElementById("promptLine").hidden = false;
	if (new URLSearchParams(window.location.search).has("fallback")) {
		print(FALLBACK_NOTE);
	}
	print("Type <span class=\"t-hi\">help</span> for commands, or click any link.\n\n");
})();
