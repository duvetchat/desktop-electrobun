// A window's own buttons on macOS (its traffic lights) put in the page's title line (#406). Loaded from the main
// process with bun:ffi (src/bun/window-buttons.ts).
//
// AppKit lays a title bar's buttons out itself and has no setting for where they go. This moves the views it made, as
// Electron's trafficLightPosition and Electrobun 2's setWindowButtonPosition do: the title bar's container is made as
// tall as the page's title line, so that the buttons stay inside it (a view takes no clicks outside its parent), and
// each button is centred in that height, the first one `left` points from the window's edge, the others after it at
// the system's own spacing.
//
// AppKit puts them back whenever it lays the title bar out again: on a resize, on leaving full screen, and when the
// window's title or its appearance (light, dark) changes. So the placement is redone:
//   - as the window says it was resized or left full screen, in the same pass, before anything is drawn;
//   - and, for the rest, once something else has moved one of those views: never in the middle of AppKit's own
//     layout, which loops until its frames hold (doing it there ended the app as it went full screen), but when
//     the run loop next turns, still before the window is drawn.
// In full screen the buttons are the system's, in the bar that slides down with the menu bar: they are left alone.
//
// Every AppKit call runs on the main thread: Electrobun runs the app's JavaScript in a worker, so FFI calls arrive
// off the main thread.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>

static const void *kPlacementKey = &kPlacementKey;

// How often within a second the buttons may be found moved back and be placed again, before the placement stops
// following: something that undoes it every time (a system this wasn't tried on) then wins, and the lights stay where
// the system has them until the window is next resized. A title or an appearance changes far less often.
static const int kMaxCatchUps = 30;

static void runOnMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

// One window's placement, kept by the window itself (an associated object): it goes when the window does.
@interface DuvetWindowButtons : NSObject
@property(nonatomic, weak) NSWindow *window;
@property(nonatomic) CGFloat left;
@property(nonatomic) CGFloat line;
- (instancetype)initWithWindow:(NSWindow *)window;
- (int)place;
@end

@implementation DuvetWindowButtons {
  BOOL _placing;
  // From one button's left edge to the next one's.
  CGFloat _pitch;
  // The title bar's views whose frames are watched. AppKit may make them anew: each is watched once.
  NSHashTable<NSView *> *_watched;
  BOOL _catchUpPending;
  int _catchUps;
  CFAbsoluteTime _firstCatchUp;
  BOOL _stoodDown;
}

- (instancetype)initWithWindow:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    _watched = [NSHashTable weakObjectsHashTable];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    for (NSNotificationName name in @[ NSWindowDidResizeNotification, NSWindowDidExitFullScreenNotification ]) {
      [center addObserver:self selector:@selector(windowChanged:) name:name object:window];
    }
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

// The window was resized or left full screen: AppKit has laid the title bar out again by now.
- (void)windowChanged:(NSNotification *)notification {
  _stoodDown = NO;
  [self place];
}

// Something moved one of the title bar's views. If that was AppKit, it may be in the middle of its layout: the
// placement is redone once it is through, when the run loop next turns.
- (void)viewMoved:(NSNotification *)notification {
  if (_placing || _catchUpPending || _stoodDown) return;
  _catchUpPending = YES;
  __weak DuvetWindowButtons *weakSelf = self;
  CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopCommonModes, ^{
    [weakSelf catchUp];
  });
  CFRunLoopWakeUp(CFRunLoopGetMain());
}

- (void)catchUp {
  _catchUpPending = NO;
  if ([self place] <= 0) return;
  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (now - _firstCatchUp > 1) {
    _firstCatchUp = now;
    _catchUps = 0;
  }
  if (++_catchUps > kMaxCatchUps) {
    _stoodDown = YES;
    NSLog(@"[window-buttons] the buttons keep being moved back: left where the system has them");
  }
}

- (void)watch:(NSArray<NSView *> *)views {
  for (NSView *view in views) {
    if ([_watched containsObject:view]) continue;
    [_watched addObject:view];
    view.postsFrameChangedNotifications = YES;
    [NSNotificationCenter.defaultCenter addObserver:self
                                           selector:@selector(viewMoved:)
                                               name:NSViewFrameDidChangeNotification
                                             object:view];
  }
}

// Puts the buttons in the title line. Returns how many views it had to move, 0 when they were in place already, and
// -1 when there is nothing to place: a window without the three buttons, or one whose buttons are the system's to
// place (full screen, or a title bar laid out right to left).
- (int)place {
  NSWindow *window = self.window;
  if (!window || _placing) return -1;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *minimize = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  if (!close || !minimize || !zoom) return -1;
  NSView *bar = close.superview;
  NSView *container = bar.superview;
  NSView *frame = container.superview;
  if (!frame || minimize.superview != bar || zoom.superview != bar) return -1;
  [self watch:@[ container, bar, close, minimize, zoom ]];

  // Full screen: the bar is the system's, and for a while its views are in a window of the system's own. Right to
  // left, the system has the buttons at the window's other end, where the page keeps no room for them.
  if ((window.styleMask & NSWindowStyleMaskFullScreen) || bar.window != window) return -1;
  if (window.windowTitlebarLayoutDirection == NSUserInterfaceLayoutDirectionRightToLeft) return -1;

  // The system's own spacing, read the first time, while the buttons are still as the system laid them out.
  if (_pitch <= 0) {
    _pitch = NSMinX(minimize.frame) - NSMinX(close.frame);
    if (_pitch <= 0) _pitch = NSWidth(close.frame) + 6;
  }

  _placing = YES;
  int moved = 0;
  CGFloat line = self.line;
  NSRect outer = container.frame;
  CGFloat top = frame.isFlipped ? 0 : NSHeight(frame.bounds) - line;
  NSRect wantedOuter = NSMakeRect(NSMinX(outer), top, NSWidth(outer), line);
  if (!NSEqualRects(outer, wantedOuter)) {
    container.frame = wantedOuter;
    moved++;
  }
  NSRect wantedBar = NSMakeRect(NSMinX(bar.frame), 0, NSWidth(bar.frame), line);
  if (!NSEqualRects(bar.frame, wantedBar)) {
    bar.frame = wantedBar;
    moved++;
  }
  CGFloat scale = window.backingScaleFactor > 0 ? window.backingScaleFactor : 1;
  CGFloat x = self.left;
  for (NSButton *button in @[ close, minimize, zoom ]) {
    CGFloat y = round((line - NSHeight(button.frame)) / 2 * scale) / scale;
    if (!NSEqualPoints(button.frame.origin, NSMakePoint(x, y))) {
      [button setFrameOrigin:NSMakePoint(x, y)];
      moved++;
    }
    x += _pitch;
  }
  _placing = NO;
  return moved;
}
@end

// Puts the window's close, minimize and zoom buttons in a title line `lineHeight` points tall at the window's top:
// centred in its height, the first one `left` points from the window's left edge, and keeps them there. Called again
// for the same window, it moves them to the new place. Returns false for something that isn't a window, or a window
// without the three buttons.
extern "C" bool wb_placeWindowButtons(void *windowPtr, double left, double lineHeight) {
  if (!windowPtr || !(lineHeight > 0) || !(left >= 0)) return false;
  __block bool kept = false;
  runOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) return;
    if (![window standardWindowButton:NSWindowCloseButton]) return;
    DuvetWindowButtons *placement = objc_getAssociatedObject(window, kPlacementKey);
    if (!placement) {
      placement = [[DuvetWindowButtons alloc] initWithWindow:window];
      objc_setAssociatedObject(window, kPlacementKey, placement, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    placement.left = left;
    placement.line = lineHeight;
    [placement place];
    kept = true;
  });
  return kept;
}
