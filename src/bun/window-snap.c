// The window procedure window-snap.ts puts in front of Electrobun's for Duvet's window on Windows. The window takes the
// styles Windows asks of a window it snaps, maximizes and minimizes from the keyboard, a caption among them, so that
// Windows maximizes it to its display's work area as it does any app window. This keeps it as it was without them: no
// frame or caption while restored, and while maximized only the frame Windows puts beyond the display's edges. It also
// starts Windows' move loop for the title bar's drag (WINDOW_SNAP_DRAG).
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

typedef struct {
	int left, top, right, bottom;
} RECT_;

#define WM_ACTIVATE 0x0006
#define WA_INACTIVE 0
#define WM_SETFOCUS 0x0007
#define WM_NCCALCSIZE 0x0083
#define WM_NCLBUTTONDOWN 0x00A1
#define HTCAPTION 2
#define WM_SYSCOMMAND 0x0112
#define SC_KEYMENU 0xF100
// WM_APP + 0x0D07, as window-snap.ts posts it: a press on the title bar that turned into a drag, at the point (in its
// lParam, as WM_NCLBUTTONDOWN has it) where it began.
#define WINDOW_SNAP_DRAG 0x8D07

static WNDPROC_ electrobunProcedure;
static CALLWINDOWPROC_ callWindowProc;
static ISZOOMED_ isZoomed;
static RELEASECAPTURE_ releaseCapture;
static GETFOCUS_ getFocus;
static SETFOCUS_ setFocus;
static ISCHILD_ isChild;
// The window in the page (the webview's) that had the keyboard as the window was last deactivated.
static HWND_ pageFocus;

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
		// A page's window that's gone is no child any more.
		if (pageFocus && isChild(window, pageFocus)) setFocus(pageFocus);
		return result;
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
	if (message == WINDOW_SNAP_DRAG) {
		// The webview, whose input Windows shares with this thread, holds the mouse since the press: released here, the
		// move loop takes it, as it does a caption's.
		releaseCapture();
		return callWindowProc(electrobunProcedure, window, WM_NCLBUTTONDOWN, HTCAPTION, lParam);
	}
	return callWindowProc(electrobunProcedure, window, message, wParam, lParam);
}

void windowSnapSetUp(void *callWindowProcFunction, void *isZoomedFunction, void *releaseCaptureFunction,
		void *getFocusFunction, void *setFocusFunction, void *isChildFunction, void *previous) {
	callWindowProc = (CALLWINDOWPROC_)callWindowProcFunction;
	isZoomed = (ISZOOMED_)isZoomedFunction;
	releaseCapture = (RELEASECAPTURE_)releaseCaptureFunction;
	getFocus = (GETFOCUS_)getFocusFunction;
	setFocus = (SETFOCUS_)setFocusFunction;
	isChild = (ISCHILD_)isChildFunction;
	electrobunProcedure = (WNDPROC_)previous;
}

void *windowSnapProcedure(void) {
	return (void *)procedure;
}
