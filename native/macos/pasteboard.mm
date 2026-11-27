// The recovery key's Copy on macOS (#569; PLAN-E2E-PLATAFORMAS.md, Task 6). Loaded from the main process with bun:ffi
// (src/bun/secret-clipboard.ts).
//
// The key goes on the pasteboard as text, for this Mac alone (NSPasteboardContentsCurrentHostOnly: Universal Clipboard
// doesn't hand it to the person's other devices) and marked concealed (org.nspasteboard.ConcealedType, which clipboard
// managers that follow nspasteboard.org leave out of their history). A minute later it comes off, while the pasteboard's
// changeCount says nothing was copied since.
//
// Every AppKit call runs on the main thread: Electrobun runs the app's JavaScript in a worker, so FFI calls arrive off the
// main thread. A test's run on the main thread itself, on a pasteboard of its own (`name`).
#import <Cocoa/Cocoa.h>

static void runOnMain(dispatch_block_t block) {
  if ([NSThread isMainThread]) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

// The pasteboard named, or the general one for NULL.
static NSPasteboard *pasteboardNamed(const char *name) {
  return name ? [NSPasteboard pasteboardWithName:[NSString stringWithUTF8String:name]] : NSPasteboard.generalPasteboard;
}

// Puts `text` (UTF-8) on the pasteboard in place of what it held: its changeCount after, or -1 when it took nothing.
extern "C" long pb_copySecret(const char *text, const char *name) {
  __block long count = -1;
  runOnMain(^{
    NSString *string = text ? [NSString stringWithUTF8String:text] : nil;
    if (!string) return;
    NSPasteboard *pasteboard = pasteboardNamed(name);
    [pasteboard prepareForNewContentsWithOptions:NSPasteboardContentsCurrentHostOnly];
    NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
    if ([item setString:string forType:NSPasteboardTypeString] &&
        [item setData:[NSData data] forType:@"org.nspasteboard.ConcealedType"] && [pasteboard writeObjects:@[ item ]]) {
      count = pasteboard.changeCount;
    }
  });
  return count;
}

// The pasteboard's changeCount, which every change of what it holds moves on.
extern "C" long pb_changeCount(const char *name) {
  __block long count = -1;
  runOnMain(^{
    count = pasteboardNamed(name).changeCount;
  });
  return count;
}

// Empties the pasteboard while its changeCount is still `copied`: 1 emptied, 0 left as something was copied since.
extern "C" int pb_clearIfUnchanged(long copied, const char *name) {
  __block int cleared = 0;
  runOnMain(^{
    NSPasteboard *pasteboard = pasteboardNamed(name);
    if (pasteboard.changeCount != copied) return;
    [pasteboard clearContents];
    cleared = 1;
  });
  return cleared;
}
