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

typedef struct {
	int left, top, right, bottom;
} RECT_;

#define WM_NCCALCSIZE 0x0083
#define WM_NCLBUTTONDOWN 0x00A1
#define HTCAPTION 2
// WM_APP + 0x0D07, as window-snap.ts posts it: a press on the title bar that turned into a drag, at the point (in its
// lParam, as WM_NCLBUTTONDOWN has it) where it began.
#define WINDOW_SNAP_DRAG 0x8D07

static WNDPROC_ electrobunProcedure;
static CALLWINDOWPROC_ callWindowProc;
static ISZOOMED_ isZoomed;
static RELEASECAPTURE_ releaseCapture;

static LRESULT_ procedure(HWND_ window, unsigned int message, WPARAM_ wParam, LPARAM_ lParam) {
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

void windowSnapSetUp(void *callWindowProcFunction, void *isZoomedFunction, void *releaseCaptureFunction, void *previous) {
	callWindowProc = (CALLWINDOWPROC_)callWindowProcFunction;
	isZoomed = (ISZOOMED_)isZoomedFunction;
	releaseCapture = (RELEASECAPTURE_)releaseCaptureFunction;
	electrobunProcedure = (WNDPROC_)previous;
}

void *windowSnapProcedure(void) {
	return (void *)procedure;
}
