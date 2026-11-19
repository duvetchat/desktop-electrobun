// Liquid Glass for Electrobun windows on macOS (NSGlassEffectView, public AppKit, macOS 26+), with an
// NSVisualEffectView fallback on macOS 14/15. Loaded from the main process with bun:ffi (src/bun/liquid-glass.ts).
//
// Every AppKit call runs on the main thread: Electrobun runs the app's JavaScript in a worker, so FFI calls
// arrive off the main thread, and AppKit/WebKit must not be touched there.
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

static const void *kGlassKey = &kGlassKey;

static void runOnMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

extern "C" bool lg_isSupported(void) {
  if (@available(macOS 26.0, *)) return true;
  return false;
}

// style: 0 = regular, 1 = clear. Tint alpha 0 = no tint.
// Returns 2 = NSGlassEffectView, 1 = NSVisualEffectView fallback, 0 = failure.
extern "C" int lg_addWindowGlass(void *windowPtr, double cornerRadius, int style,
                                 double r, double g, double b, double a) {
  if (!windowPtr) return 0;
  __block int result = 0;
  runOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) return;
    NSView *content = window.contentView;
    if (!content) return;

    NSView *old = objc_getAssociatedObject(window, kGlassKey);
    if (old) [old removeFromSuperview];

    NSView *backdrop = nil;
    if (@available(macOS 26.0, *)) {
      NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:content.bounds];
      glass.cornerRadius = cornerRadius;
      glass.style = (style == 1) ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
      if (a > 0) glass.tintColor = [NSColor colorWithSRGBRed:r green:g blue:b alpha:a];
      backdrop = glass;
      result = 2;
    } else {
      NSVisualEffectView *fx = [[NSVisualEffectView alloc] initWithFrame:content.bounds];
      fx.material = NSVisualEffectMaterialUnderWindowBackground;
      fx.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      fx.state = NSVisualEffectStateFollowsWindowActiveState;
      backdrop = fx;
      result = 1;
    }
    backdrop.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    // Bottom of the z-order. Electrobun adds webviews with NSWindowAbove relativeTo:nil, so every webview,
    // whenever it is created, stays above the glass.
    [content addSubview:backdrop positioned:NSWindowBelow relativeTo:nil];
    objc_setAssociatedObject(window, kGlassKey, backdrop, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    // Electrobun's `transparent: true` turns the window shadow off; bring it back.
    window.hasShadow = YES;
    [window invalidateShadow];
  });
  return result;
}

extern "C" void lg_removeWindowGlass(void *windowPtr) {
  if (!windowPtr) return;
  runOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    NSView *old = objc_getAssociatedObject(window, kGlassKey);
    if (old) [old removeFromSuperview];
    objc_setAssociatedObject(window, kGlassKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  });
}

// The glass's own appearance: 0 = the window's (it follows the system), 1 = light (Aqua), 2 = dark (Dark Aqua).
// Set on the glass view only, never on the window: the window's appearance would change the page's
// prefers-color-scheme, which Duvet's System theme reads. Returns false when the window has no glass.
extern "C" bool lg_setGlassAppearance(void *windowPtr, int appearance) {
  if (!windowPtr) return false;
  __block bool done = false;
  runOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    NSView *glass = objc_getAssociatedObject(window, kGlassKey);
    if (!glass) return;
    glass.appearance = appearance == 1   ? [NSAppearance appearanceNamed:NSAppearanceNameAqua]
                       : appearance == 2 ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]
                                         : nil;
    done = true;
  });
  return done;
}

// QA aid: NSLogs the window's state and its content view's subviews, bottom to top.
// Expected: opaque=0 hasShadow=1, subview[0] NSGlassEffectView, then the WKWebView with drawsBackground=0.
extern "C" void lg_debugDump(void *windowPtr) {
  if (!windowPtr) return;
  runOnMain(^{
    NSWindow *w = (__bridge NSWindow *)windowPtr;
    NSLog(@"[liquid-glass] window opaque=%d hasShadow=%d styleMask=0x%lx", w.opaque, w.hasShadow,
          (unsigned long)w.styleMask);
    NSUInteger i = 0;
    for (NSView *v in w.contentView.subviews) {
      NSLog(@"[liquid-glass] subview[%lu] %@ frame=%@", (unsigned long)i++, v.className, NSStringFromRect(v.frame));
      if ([v isKindOfClass:[WKWebView class]])
        NSLog(@"[liquid-glass]   drawsBackground=%@", [v valueForKey:@"drawsBackground"]);
    }
  });
}

// EXPERIMENTAL, PRIVATE WebKit API — not App Store safe, may break on any macOS update.
// Turns on WebKit's `-apple-visual-effect` CSS property (e.g. -apple-system-glass-material) in every
// WKWebView of the window, then reloads them. Returns the number of webviews switched, -2 if unsupported.
static void collectWebViews(NSView *root, NSMutableArray<WKWebView *> *out) {
  for (NSView *v in root.subviews) {
    if ([v isKindOfClass:[WKWebView class]]) [out addObject:(WKWebView *)v];
    else collectWebViews(v, out);
  }
}

extern "C" int lg_enablePrivateCssGlass(void *windowPtr) {
  if (!windowPtr) return -1;
  __block int count = 0;
  runOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    NSMutableArray<WKWebView *> *webViews = [NSMutableArray array];
    collectWebViews(window.contentView, webViews);
    SEL sel = NSSelectorFromString(@"_setUseSystemAppearance:");
    for (WKWebView *wv in webViews) {
      WKPreferences *prefs = wv.configuration.preferences;
      if (![prefs respondsToSelector:sel]) { count = -2; return; }
      ((void (*)(id, SEL, BOOL))objc_msgSend)(prefs, sel, YES); // BOOL ABI, not performSelector:withObject:
      [wv reload];
      count++;
    }
  });
  return count;
}
