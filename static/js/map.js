// The museum map's view: panning, zooming, and pinching the plan inside its frame by moving the SVG's viewBox, kept in the plan's own meters so the visitor's mark and every room stay where the plan put them.
(function () {
	"use strict";

	// MARK: Constants
	// Meters of plan shown across the frame's height when the map opens, the closest the view may come, and the factor each zoom button and wheel notch scales by
	const START_SPAN = 40;
	const MIN_SPAN = 8;
	const BUTTON_ZOOM = 1.5;
	const WHEEL_ZOOM = 0.0015;

	// Trackpad pinches arrive as small ctrl+wheel deltas, so they scale harder
	const PINCH_WHEEL_ZOOM = 0.01;

	// How far a press may move, in pixels, and still count as a click on a room
	const CLICK_SLOP = 5;

	// MARK: Functions
	// Make `frame` a pan and zoom view of the plan inside it, opening centered on `here` (sheet meters) and calling `onPick(id)` when a room is clicked rather than dragged
	window.MapView = function (frame, onPick, here) {
		const plan = frame.querySelector("svg");
		const [, , sheetW, sheetH] = plan.getAttribute("viewBox").split(/\s+/).map(Number);
		const pointers = new Map();
		let view = { x: 0, y: 0, w: sheetW, h: sheetH };
		let dragged = 0;
		let pinch = 0;

		// The frame's width over its height
		function aspect() {
			return frame.clientWidth / Math.max(1, frame.clientHeight);
		}

		// Write the view, kept between the closest zoom and the whole sheet, and over the sheet wherever it can be
		function apply() {
			const r = aspect();
			const maxH = Math.max(sheetH, sheetW / r);
			view.h = Math.min(Math.max(view.h, MIN_SPAN), maxH);
			view.w = view.h * r;
			view.x = view.w >= sheetW ? (sheetW - view.w) / 2 : Math.min(Math.max(view.x, 0), sheetW - view.w);
			view.y = view.h >= sheetH ? (sheetH - view.h) / 2 : Math.min(Math.max(view.y, 0), sheetH - view.h);
			plan.setAttribute("viewBox", [view.x, view.y, view.w, view.h].map((v) => v.toFixed(3)).join(" "));
		}

		// A point on the screen in sheet meters
		function toSheet(clientX, clientY) {
			const box = frame.getBoundingClientRect();
			return { x: view.x + (clientX - box.left) / box.width * view.w, y: view.y + (clientY - box.top) / box.height * view.h };
		}

		// Scale the view by `factor` about a sheet point, which stays under the same spot on screen
		function zoomAbout(factor, point) {
			view.x = point.x - (point.x - view.x) * factor;
			view.y = point.y - (point.y - view.y) * factor;
			view.h *= factor;
			apply();
		}

		// Center the view on the visitor at the opening zoom
		function center() {
			view.h = START_SPAN;
			view.w = START_SPAN * aspect();
			view.x = here.x - view.w / 2;
			view.y = here.y - view.h / 2;
			apply();
		}

		// The distance between the first two pointers down, in pixels
		function spread() {
			const [a, b] = [...pointers.values()];
			return Math.hypot(a.x - b.x, a.y - b.y);
		}

		// WARN: Without a non-passive listener the browser zooms or scrolls the page instead.
		frame.addEventListener("wheel", (event) => {
			event.preventDefault();
			const rate = event.ctrlKey ? PINCH_WHEEL_ZOOM : WHEEL_ZOOM;
			zoomAbout(Math.exp(event.deltaY * rate), toSheet(event.clientX, event.clientY));
		}, { passive: false });

		// WARN: Capture the pointer so a drag that leaves the frame keeps panning; the click after it then targets the frame, so room picks happen on release instead.
		frame.addEventListener("pointerdown", (event) => {
			if (event.target.closest("button")) {
				return;
			}
			frame.setPointerCapture(event.pointerId);
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (pointers.size === 1) {
				dragged = 0;
			} else if (pointers.size === 2) {
				pinch = spread();
			}
		});

		frame.addEventListener("pointermove", (event) => {
			const last = pointers.get(event.pointerId);
			if (!last) {
				return;
			}
			const dx = event.clientX - last.x;
			const dy = event.clientY - last.y;
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			dragged += Math.hypot(dx, dy);

			// Pinch with two pointers about their middle, or pan with one
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				const now = spread();
				zoomAbout(pinch / Math.max(1, now), toSheet((a.x + b.x) / 2, (a.y + b.y) / 2));
				pinch = now;
			} else {
				view.x -= dx / frame.clientWidth * view.w;
				view.y -= dy / frame.clientHeight * view.h;
				apply();
			}
		});

		// Pick the room under a press that never became a drag
		function release(event) {
			if (!pointers.delete(event.pointerId)) {
				return;
			}
			if (event.type === "pointerup" && pointers.size === 0 && dragged <= CLICK_SLOP) {
				const room = document.elementFromPoint(event.clientX, event.clientY);
				const target = room && room.closest("[data-travel]");
				if (target) {
					onPick(target.dataset.travel);
				}
			}
			dragged = pointers.size ? CLICK_SLOP + 1 : dragged;
		}
		frame.addEventListener("pointerup", release);
		frame.addEventListener("pointercancel", release);

		// The zoom and centering buttons
		frame.addEventListener("click", (event) => {
			const button = event.target.closest("button[data-zoom]");
			if (!button) {
				return;
			}
			const middle = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
			if (button.dataset.zoom === "in") {
				zoomAbout(1 / BUTTON_ZOOM, middle);
			} else if (button.dataset.zoom === "out") {
				zoomAbout(BUTTON_ZOOM, middle);
			} else {
				center();
			}
		});

		center();
	};
})();
