// The window procedure window-snap.ts puts in front of Electrobun's for Duvet's window on Windows. The window takes the
// styles Windows asks of a window it snaps, maximizes and minimizes from the keyboard, a caption among them, so that
// Windows maximizes it to its display's work area as it does any app window. This keeps it as it was without them: no
// frame or caption while restored, and while maximized only the frame Windows puts beyond the display's edges.
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

typedef struct {
	int left, top, right, bottom;
} RECT_;
typedef struct {
	HWND_ hwnd;
	HWND_ hwndInsertAfter;
	int x, y, cx, cy;
	unsigned int flags;
} WINDOWPOS_;

#define WM_WINDOWPOSCHANGING 0x0046
#define WM_NCCALCSIZE 0x0083
#define SWP_NOSIZE 0x0001
#define SWP_NOMOVE 0x0002
#define SWP_NOZORDER 0x0004
#define SWP_NOACTIVATE 0x0010
#define SWP_FRAMECHANGED 0x0020
#define SWP_SHOWWINDOW 0x0040
#define SWP_HIDEWINDOW 0x0080
#define PLACEMENT (SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_HIDEWINDOW)
// Electrobun's title-bar drag (startWindowMove, then each WM_INPUT) moves the window with these, and nothing else.
#define ELECTROBUN_DRAG (SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)

static WNDPROC_ electrobunProcedure;
static CALLWINDOWPROC_ callWindowProc;
static ISZOOMED_ isZoomed;

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
	if (message == WM_WINDOWPOSCHANGING && isZoomed(window)) {
		// A maximized window stays where Windows put it: moved by Electrobun's drag, it would stay maximized off its display.
		WINDOWPOS_ *position = (WINDOWPOS_ *)lParam;
		if ((position->flags & PLACEMENT) == ELECTROBUN_DRAG) position->flags |= SWP_NOMOVE;
	}
	return callWindowProc(electrobunProcedure, window, message, wParam, lParam);
}

void windowSnapSetUp(void *callWindowProcFunction, void *isZoomedFunction, void *previous) {
	callWindowProc = (CALLWINDOWPROC_)callWindowProcFunction;
	isZoomed = (ISZOOMED_)isZoomedFunction;
	electrobunProcedure = (WNDPROC_)previous;
}

void *windowSnapProcedure(void) {
	return (void *)procedure;
}
