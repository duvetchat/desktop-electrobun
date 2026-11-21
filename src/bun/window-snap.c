// The window procedure window-snap.ts puts in front of Electrobun's for Duvet's window on Windows. The window takes the
// styles Windows asks of a window it snaps, maximizes and minimizes from the keyboard, a caption among them, so that
// Windows maximizes it to its display's work area as it does any app window. This keeps it as it was without them: no
// frame or caption while restored, and while maximized only the frame Windows puts beyond the display's edges. It also
// starts Windows' move loop for the title bar's drag (WINDOW_SNAP_DRAG), gives the page the keyboard as the window
// gets it (#361), and tells Windows the smallest the window may be made (#419).
//
// TinyCC compiles it as the window opens (bun:ffi's cc), with no headers: the few Windows types it needs are declared
// here, and the user32 functions it calls come from window-snap.ts. One window per process.

typedef long long LRESULT_;
typedef unsigned long long WPARAM_;
typedef long long LPARAM_;
typedef void *HWND_;
typedef LRESULT_ (*WNDPROC_)(HWND_, unsigned int, WPARAM_, LPARAM_);
typedef LRESULT_ (*CALLWINDOWPROC_)(WNDPROC_, HWND_, unsigned int, WPARAM_, LPARAM_);
typedef int (*ISZOOMED_)(HWND_);
typedef int (*RELEASECAPTURE_)(void);
typedef HWND_ (*GETFOCUS_)(void);
typedef HWND_ (*SETFOCUS_)(HWND_);
typedef int (*ISCHILD_)(HWND_, HWND_);
typedef int (*ENUMCHILDPROC_)(HWND_, LPARAM_);
typedef int (*ENUMCHILDWINDOWS_)(HWND_, ENUMCHILDPROC_, LPARAM_);
typedef int (*GETCLASSNAMEA_)(HWND_, char *, int);
typedef int (*ISWINDOWVISIBLE_)(HWND_);
typedef unsigned int (*GETDPIFORWINDOW_)(HWND_);

typedef struct {
	int left, top, right, bottom;
} RECT_;

typedef struct {
	int x, y;
} POINT_;

// MINMAXINFO: what WM_GETMINMAXINFO asks a window of the sizes it takes.
typedef struct {
	POINT_ reserved, maxSize, maxPosition, minTrackSize, maxTrackSize;
} MINMAXINFO_;

#define WM_ACTIVATE 0x0006
#define WA_INACTIVE 0
#define WM_SETFOCUS 0x0007
#define WM_GETMINMAXINFO 0x0024
#define WM_NCCALCSIZE 0x0083
#define WM_NCLBUTTONDOWN 0x00A1
#define HTCAPTION 2
#define WM_SYSCOMMAND 0x0112
#define SC_KEYMENU 0xF100
// WM_APP + 0x0D07, as window-snap.ts posts it: a press on the title bar that turned into a drag, at the point (in its
// lParam, as WM_NCLBUTTONDOWN has it) where it began.
#define WINDOW_SNAP_DRAG 0x8D07
// WM_APP + 0x0D08, as window-snap.ts posts it as the page loads (dom-ready).
#define WINDOW_SNAP_PAGE_READY 0x8D08

static WNDPROC_ electrobunProcedure;
static CALLWINDOWPROC_ callWindowProc;
static ISZOOMED_ isZoomed;
static RELEASECAPTURE_ releaseCapture;
static GETFOCUS_ getFocus;
static SETFOCUS_ setFocus;
static ISCHILD_ isChild;
static ENUMCHILDWINDOWS_ enumChildWindows;
static GETCLASSNAMEA_ getClassName;
static ISWINDOWVISIBLE_ isWindowVisible;
// GetDpiForWindow, or 0 where user32 has none (before Windows 10 1607).
static GETDPIFORWINDOW_ getDpiForWindow;
// The smallest the window may be made, in logical pixels (at 96 DPI); 0 for no limit.
static int minimumWidth, minimumHeight;
// The window in the page (the webview's) that had the keyboard as the window was last deactivated.
static HWND_ pageFocus;

// The webview's own window, where a click in the page puts the keyboard: Chromium's Chrome_WidgetWin_1.
static const char pageClass[] = "Chrome_WidgetWin_1";

static int findPage(HWND_ child, LPARAM_ found) {
	char name[sizeof pageClass + 1];
	int length = getClassName(child, name, sizeof name);
	if (length != sizeof pageClass - 1 || !isWindowVisible(child)) return 1;
	for (int i = 0; i < length; i++)
		if (name[i] != pageClass[i]) return 1;
	*(HWND_ *)found = child;
	return 0;
}

// The page's window, or 0 while the webview hasn't made it.
static HWND_ pageWindow(HWND_ window) {
	HWND_ found = 0;
	enumChildWindows(window, findPage, (LPARAM_)&found);
	return found;
}

static LRESULT_ procedure(HWND_ window, unsigned int message, WPARAM_ wParam, LPARAM_ lParam) {
	// Electrobun gives the webview no focus as Windows activates the window (an Alt+Tab, win.focus()): Windows' default
	// gives the window itself the keyboard, where no key reaches the page. As Windows' dialogs do, the window keeps what
	// in it had the keyboard as it's deactivated, and gives it back as it gets the keyboard.
	if (message == WM_ACTIVATE && (wParam & 0xFFFF) == WA_INACTIVE) {
		HWND_ focus = getFocus();
		if (focus && isChild(window, focus)) pageFocus = focus;
	}
	if (message == WM_SETFOCUS) {
		LRESULT_ result = callWindowProc(electrobunProcedure, window, message, wParam, lParam);
		// A page's window that's gone is no child any more. With nothing kept (no click in the page yet), the page's
		// window takes the keyboard.
		HWND_ page = pageFocus && isChild(window, pageFocus) ? pageFocus : pageWindow(window);
		if (page) setFocus(page);
		return result;
	}
	if (message == WINDOW_SNAP_PAGE_READY) {
		// The page has loaded: while the window itself has the keyboard (it got it before the webview made its window),
		// the page's window takes it, as Duvet opens.
		if (getFocus() == window) {
			HWND_ page = pageWindow(window);
			if (page) setFocus(page);
		}
		return 0;
	}
	// The system menu the window takes for Win+Up and Win+Down has no caption to show in: Alt alone or F10 would open it
	// unseen, and its loop would take the next keys. Alt+Space, which shows it, still opens it.
	if (message == WM_SYSCOMMAND && (wParam & 0xFFF0) == SC_KEYMENU && lParam == 0) return 0;
	if (message == WM_NCCALCSIZE && wParam) {
		// Restored, the client area is the whole window, as before the frame and caption: 0 keeps the rectangle Windows
		// proposes.
		if (!isZoomed(window)) return 0;
		// Maximized, Windows puts the frame just beyond the display's edges: the client area keeps the frame's inset on
		// every side, the top's as wide as the sides', with no caption.
		RECT_ *client = (RECT_ *)lParam;
		RECT_ proposed = *client;
		LRESULT_ result = callWindowProc(electrobunProcedure, window, message, wParam, lParam);
		client->top = proposed.top + (client->left - proposed.left);
		return result;
	}
	if (message == WM_GETMINMAXINFO && minimumWidth > 0 && minimumHeight > 0) {
		// The smallest size a drag of the frame, a snap or SetWindowPos gives the window: the minimum in the pixels of
		// the display the window is on, which its DPI says (96 at 100%).
		LRESULT_ result = callWindowProc(electrobunProcedure, window, message, wParam, lParam);
		MINMAXINFO_ *sizes = (MINMAXINFO_ *)lParam;
		unsigned int dpi = getDpiForWindow ? getDpiForWindow(window) : 96;
		if (dpi == 0) dpi = 96;
		sizes->minTrackSize.x = (int)((long long)minimumWidth * dpi / 96);
		sizes->minTrackSize.y = (int)((long long)minimumHeight * dpi / 96);
		return result;
	}
	if (message == WINDOW_SNAP_DRAG) {
		// The webview, whose input Windows shares with this thread, holds the mouse since the press: released here, the
		// move loop takes it, as it does a caption's.
		releaseCapture();
		return callWindowProc(electrobunProcedure, window, WM_NCLBUTTONDOWN, HTCAPTION, lParam);
	}
	return callWindowProc(electrobunProcedure, window, message, wParam, lParam);
}

void windowSnapSetUp(void *callWindowProcFunction, void *isZoomedFunction, void *releaseCaptureFunction,
		void *getFocusFunction, void *setFocusFunction, void *isChildFunction, void *enumChildWindowsFunction,
		void *getClassNameFunction, void *isWindowVisibleFunction, void *previous) {
	callWindowProc = (CALLWINDOWPROC_)callWindowProcFunction;
	isZoomed = (ISZOOMED_)isZoomedFunction;
	releaseCapture = (RELEASECAPTURE_)releaseCaptureFunction;
	getFocus = (GETFOCUS_)getFocusFunction;
	setFocus = (SETFOCUS_)setFocusFunction;
	isChild = (ISCHILD_)isChildFunction;
	enumChildWindows = (ENUMCHILDWINDOWS_)enumChildWindowsFunction;
	getClassName = (GETCLASSNAMEA_)getClassNameFunction;
	isWindowVisible = (ISWINDOWVISIBLE_)isWindowVisibleFunction;
	electrobunProcedure = (WNDPROC_)previous;
}

// The smallest the window may be made from here on, in logical pixels, and user32's GetDpiForWindow (0 without it).
void windowSnapSetMinimum(void *getDpiForWindowFunction, int width, int height) {
	getDpiForWindow = (GETDPIFORWINDOW_)getDpiForWindowFunction;
	minimumWidth = width;
	minimumHeight = height;
}

void *windowSnapProcedure(void) {
	return (void *)procedure;
}
