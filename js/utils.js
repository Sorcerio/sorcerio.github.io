// Web4 Portfolio: JS-Rust Linked Functions

// NOTE: Updates not showing up? Try clearing your browser cache!
// WARN: `window.onresize` is defined within Godot!

// MARK: Constants
const MAIN_CANVAS_QUERY = "#canvas";
const HISTORY_PAGE_KEY = "page";

// MARK: focusMainCanvas
function focusMainCanvas() {
    const canvas = document.querySelector(MAIN_CANVAS_QUERY);
    if (canvas) {
        // Focus canvas
        canvas.focus();

        // Request pointer lock
        canvas.requestPointerLock();
    }
}

// MARK: timestampHash
function timestampHash() {
    return Date.now().toString(36);
}

// MARK: navigateToPage
function navigateToPage(pagePath, newTab = true) {
    // Report
    console.log("Navigating to page: " + pagePath);

    // Go to the page
    if (newTab) {
        window.open(pagePath, "_blank");
    } else {
        window.location.href = pagePath;
    }
}

// MARK: showSubPage
function showSubPage(pageKey) {
    // Strings!
    pageKey = String(pageKey);

    // Create the id hash
    const idHash = timestampHash()

    // Report
    console.log("Showing HTML page: " + pageKey);

    // Create window container
    const windowFrameId = ("window_" + idHash);
    const container = document.createElement("div");
    container.id = windowFrameId;
    container.classList.add("windowFrame");

    // Create main window
    const mainWindow = document.createElement("div");
    mainWindow.classList.add("window", "main", pageKey);

    // Create title bar
    const titleBar = document.createElement("div");
    titleBar.classList.add("title-bar");

    const titleBarText = document.createElement("div");
    titleBarText.classList.add("title-bar-text");
    titleBarText.innerText = getPageTitle(pageKey);

    const titleBarControls = document.createElement("div");
    titleBarControls.classList.add("title-bar-controls");

    // const helpButton = document.createElement("button");
    // helpButton.setAttribute("aria-label", "Help");
    // // TODO: Add a help action

    const closeButton = document.createElement("button");
    closeButton.setAttribute("aria-label", "Close");
    closeButton.addEventListener("click", function() {
        closePopupPage(windowFrameId);
    });

    // titleBarControls.appendChild(helpButton);
    titleBarControls.appendChild(closeButton);

    titleBar.appendChild(titleBarText);
    titleBar.appendChild(titleBarControls);

    // Create window body
    const bodyId = ("windowbody_" + idHash);
    const windowBody = document.createElement("div");
    windowBody.id = bodyId;
    windowBody.classList.add("window-body");

    // Add loading banner
    const loadingBanner = document.createElement("div");
    loadingBanner.classList.add("progress-indicator", "segmented");
    loadingBanner.style.width = "42vw";
    loadingBanner.style.margin = "16px";

    const loadingBar = document.createElement("span");
    loadingBar.classList.add("progress-indicator-bar", "scroll");

    loadingBanner.appendChild(loadingBar);
    windowBody.appendChild(loadingBanner);

    // Append title bar and window body to main window
    mainWindow.appendChild(titleBar);
    mainWindow.appendChild(windowBody);

    // Append main window to container
    container.appendChild(mainWindow);

    // Append container to body
    document.body.appendChild(container);

    // Populate the window body
    loadHTML(getPagePath(pageKey), bodyId);

    // Update history
    const newHistory = new URL(location);
    newHistory.searchParams.set(HISTORY_PAGE_KEY, pageKey);
    history.pushState({}, "", newHistory);

    // Release pointer lock
    document.exitPointerLock();
}

// MARK: closePopupPage
function closePopupPage(targetId) {
    // Remove container
    const container = document.querySelector("#" + targetId);
    if (container) {
        container.remove();
    }

    // Update history
    const newHistory = new URL(location);
    newHistory.searchParams.delete(HISTORY_PAGE_KEY);
    history.pushState({}, "", newHistory); // index

    // Refocus on canvas
    focusMainCanvas();

    // Report
    console.log("Closed HTML page: " + targetId);
}

// MARK: getPagePath
function getPagePath(id) {
    switch (id) {
        case "about":
            return "pages/about.html";
        case "contact":
            return "pages/contact.html";
        case "projects":
            return "pages/projects.html";
        case "resume":
            return "pages/resume.html";
        case "index.html":
            return null;
        default:
            return "pages/404.html";
    }
}

// MARK: getPageTitle
function getPageTitle(id) {
    switch (id) {
        case "about":
            return "About Me";
        case "contact":
            return "Contact Me";
        case "projects":
            return "Projects";
        case "resume":
            return "Resume";
        case "index.html":
            return null;
        default:
            return "404";
    }
}

// MARK: loadHTML
async function loadHTML(filePath, targetElementId) {
    try {
        // Fetch the HTML file
        const response = await fetch(filePath);

        // Check if the fetch was successful
        if (!response.ok) {
            console.error(`Failed to fetch ${filePath}: ${response.statusText}`);
            throw new Error(`Failed to fetch ${filePath}: ${response.statusText}`);
        }

        // Get the text content of the HTML file
        const htmlContent = await response.text();

        // Find the target element in the current DOM
        const targetElement = document.getElementById(targetElementId);

        // Insert the HTML content into the target element
        if (targetElement) {
            targetElement.innerHTML = ('<div class="bodyContent">' + htmlContent + "</div>");
        } else {
            console.error(`Element with ID ${targetElementId} not found.`);
        }
    } catch (error) {
        console.error('Error loading HTML:', error);
    }
}

// MARK: popstate
window.addEventListener("popstate", function(event) {
    // TODO: Close all popups w/ closePopupPage or something
});

// MARK: DOMContentLoaded
document.addEventListener("DOMContentLoaded", function() {
    // Focus main canvas
    focusMainCanvas();

    // Get subpage tag if present
    const urlParams = new URLSearchParams(window.location.search);
    const subpageTag = urlParams.get("page");
    if (subpageTag) {
        // Show the subpage
        showSubPage(subpageTag);
    }

    // Enable refocusing
    const canvas = document.querySelector(MAIN_CANVAS_QUERY);
    if (canvas) {
        canvas.addEventListener("click", function() {
            focusMainCanvas();
        });
    }
});
