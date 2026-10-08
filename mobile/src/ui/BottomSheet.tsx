import {
  createContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, fontWeight, radius, scrim, spacing, theme } from "../theme";
import { IconButton } from "./IconButton";
import { DISMISS_DISTANCE, sheetRelease } from "./sheetPull";

// Slide-up modal sheet with a handle + title, capped at 80% height and
// scrolling within.
//
// Motion: the backdrop FADES while the sheet SLIDES (RN's
// `animationType="slide"` animates the whole modal, dragging the scrim up from
// the bottom with it, which reads as one moving slab instead of a dimmed
// screen). Hence `animationType="none"` plus two driven values.
//
// The whole sheet drags, not only its handle: pull it down past ~120pt (or
// flick it) to dismiss, otherwise it springs back. Content that scrolls drags
// the sheet once it is at its top, in the same gesture.
//
// That hand-off cannot be done from JS. A native ScrollView claims a vertical
// drag synchronously, at its touch slop, before a PanResponder has been asked;
// it does so even at its top with nowhere to scroll, and the JS touch is
// cancelled. So the sheet itself is the content of an OUTER ScrollView, below
// a spacer one screen tall, resting scrolled to the end: dragging the sheet
// down IS scrolling the outer view up. The inner ScrollView hands whatever it
// cannot scroll to the outer one (Android nested scrolling,
// `nestedScrollEnabled`), which is what makes one gesture cross from scrolling
// to dragging without a jump. Guard: `sheetPull.test.ts`.
//
// ponytail: Android only. iOS does not chain two vertical scroll views inside
// one gesture, so there a scrollable sheet drags by its header; it needs a
// pan recogniser of its own if Logjam GPS ships on iOS.
//
// Coverage: `statusBarTranslucent` + `navigationBarTranslucent` put the scrim
// behind BOTH system bars, and the sheet carries the bottom inset in its own
// padding — so its surface runs to the physical bottom edge instead of
// stopping on the tab bar's colour.
const SHEET_TRAVEL = Dimensions.get("window").height;
// How long the sheet must lie still, untouched, before it springs back or
// closes. A fling keeps reporting scroll, so it is never cut short.
const SETTLE_MS = 80;
// How long a close asked for by the drag has to take effect before the sheet
// springs back instead. Longer than the owner needs to re-render; a sheet that
// answers a close by staying open (a sub-mode going back to its form) is back
// in place before the finger returns.
const CLOSE_GRACE_MS = 400;

/**
 * Lets a child freeze the sheet's scroll for the rest of a touch.
 *
 * A gesture has ONE owner. The scroll and a child that reads a drag (the
 * profile charts) are competing for the same finger, and the native ScrollView
 * will happily intercept a drag mid-way through if it wanders vertically past
 * its touch slop — so a scrub that curves gets stolen and the reading jumps
 * away under the finger. A child that has decided the gesture is ITS gesture
 * locks the scroll until the finger lifts.
 *
 * The context is optional: a chart rendered outside a sheet reads null here and
 * simply has nothing to lock.
 */
export const SheetScrollLock = createContext<{
  setLocked: (locked: boolean) => void;
} | null>(null);

/**
 * How a `FieldError` that has just appeared asks the sheet to bring it into
 * view (docs/ux-principles.md §11, "Form errors"). Null outside a sheet.
 */
export const SheetErrorReveal = createContext<((target: View) => void) | null>(
  null,
);

export function BottomSheet({
  visible,
  onClose,
  onClosed,
  title,
  onBack,
  footer,
  overlay,
  header,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /**
   * Renders a back arrow beside the title. Present only for a sheet showing a
   * SUB-MODE — it returns to the parent mode, and is not a way to close.
   */
  onBack?: () => void;
  /**
   * Fired once the sheet has finished closing AND unmounted. Use it to run
   * anything that must not overlap the modal window — a permission request or a
   * system picker launched while a Modal is up can never attach its own window,
   * and its promise simply never settles.
   */
  onClosed?: () => void;
  /**
   * Pinned below the scroll area — put the sheet's primary action here whenever
   * its content can outgrow the 80% cap. A confirm button that scrolls away
   * with a long list leaves the handle as the only way out, and dragging the
   * handle means "discard", not "done".
   */
  footer?: React.ReactNode;
  /**
   * A sub-mode drawn OVER the scroll area, with `children` left mounted
   * underneath. Use it for a step that replaces the sheet's content
   * temporarily — a date picker inside a long filter list.
   *
   * Swapping `children` instead would collapse the scroll content to the
   * sub-mode's height; RN clamps the offset to 0, and the user lands back at
   * the top of a list they were halfway down.
   *
   * It is absolutely positioned, so it cannot make the sheet taller: keep
   * overlay content shorter than the list it covers.
   */
  overlay?: React.ReactNode;
  /**
   * Pinned ABOVE the scroll area — the mirror of `footer`. For a filter or
   * search field that governs the list: scrolling the control that narrows the
   * list out of reach is how you end up hunting a list you were given a way to
   * search.
   */
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [scrollLocked, setScrollLocked] = useState(false);
  const scrollLock = useMemo(
    () => ({ setLocked: (locked: boolean) => setScrollLocked(locked) }),
    [],
  );
  // A submit can turn up several errors at once. Each reports itself; the
  // topmost of the frame wins, and the sheet scrolls only when THAT one is out
  // of view — so a live limit appearing under the field being typed in never
  // moves the sheet.
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const viewport = useRef({ y: 0, height: 0 });
  const pendingReveal = useRef<{ y: number; height: number } | null>(null);
  const revealError = useMemo(
    () => (target: View) => {
      const content = contentRef.current;
      if (content == null) return;
      target.measureLayout(content, (_left, top, _width, height) => {
        const pending = pendingReveal.current;
        if (pending != null) {
          if (top < pending.y) pendingReveal.current = { y: top, height };
          return;
        }
        pendingReveal.current = { y: top, height };
        requestAnimationFrame(() => {
          const first = pendingReveal.current;
          pendingReveal.current = null;
          if (first == null) return;
          const { y, height: visible } = viewport.current;
          if (first.y >= y && first.y + first.height <= y + visible) return;
          scrollRef.current?.scrollTo({
            y: Math.max(0, first.y - visible / 2),
            animated: true,
          });
        });
      });
    },
    [],
  );
  // Keyboard handling is done by hand rather than with KeyboardAvoidingView.
  // KAV's "height" behavior shrinks its own frame, and a sheet that MOUNTS
  // while the IME is already up inherits that shrunk frame and never gets it
  // back — the sheet then floats a nav-bar's height above the screen edge with
  // a stripe of tab bar showing beneath it. Measuring the keyboard ourselves
  // and lifting by exactly that much is deterministic in both orders.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardHeight(0),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const keyboardUp = keyboardHeight > 0;
  // Kept mounted through the close animation, then torn down.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  const notifyClosed = useEffectEvent(() => onClosed?.());
  const [progress] = useState(() => new Animated.Value(0));
  // The modal's own height: the spacer above the sheet is exactly this tall,
  // so the sheet can be dragged fully off the bottom edge.
  const [viewportHeight, setViewportHeight] = useState(SHEET_TRAVEL);
  const outerRef = useRef<ScrollView>(null);
  // The outer scroll as last reported; the sheet is pulled down by however far
  // that is from its end. `touching`: a finger is dragging it. `dragged`: a
  // finger has, since it last settled. `closingUntil`: the drag has asked to
  // close, and the owner may take a few frames to say so; springing back
  // before this time would fight the slide out.
  const pull = useRef({
    content: 0,
    viewport: 0,
    y: 0,
    touching: false,
    dragged: false,
    closingUntil: 0,
  });
  const pulled = () =>
    Math.max(0, pull.current.content - pull.current.viewport - pull.current.y);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      // A sheet reopened while still sliding out is wherever it was dragged to.
      pull.current.touching = false;
      pull.current.dragged = false;
      pull.current.closingUntil = 0;
      outerRef.current?.scrollToEnd({ animated: false });
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setMounted(false);
      notifyClosed();
    });
  }, [progress, visible]);

  // The settle runs from a timer, so it reads the current props through a ref.
  const settleRef = useRef(() => {});
  useEffect(() => {
    settleRef.current = () => {
      if (
        !visible ||
        pull.current.touching ||
        Date.now() < pull.current.closingUntil
      )
        return;
      const outcome = sheetRelease({
        pulled: pulled(),
        dragged: pull.current.dragged,
      });
      pull.current.dragged = false;
      if (outcome === "close") {
        pull.current.closingUntil = Date.now() + CLOSE_GRACE_MS;
        onClose();
        // A little past the grace, so this settle is not itself refused.
        setTimeout(() => settleRef.current(), CLOSE_GRACE_MS + 20);
      } else if (outcome === "snap")
        outerRef.current?.scrollToEnd({ animated: true });
    };
  });
  useEffect(
    () => () => {
      if (settleTimer.current != null) clearTimeout(settleTimer.current);
    },
    [],
  );
  const settleSoon = () => {
    if (settleTimer.current != null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settleRef.current(), SETTLE_MS);
  };
  // Both scroll views report the drag: whichever one the finger landed in owns
  // the touch, and the inner one moves the sheet through the outer.
  const dragHandlers = {
    onScrollBeginDrag: () => {
      pull.current.touching = true;
      pull.current.dragged = true;
    },
    onScrollEndDrag: () => {
      pull.current.touching = false;
      settleSoon();
    },
  };

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SHEET_TRAVEL, 0],
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View
        style={[styles.backdrop, { opacity: progress }]}
        pointerEvents="none"
      />
      <ScrollView
        ref={outerRef}
        style={styles.dock}
        // Not a scroll container to a screen reader: its one job is the drag.
        importantForAccessibility="no"
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        keyboardShouldPersistTaps="handled"
        // A child that owns the touch (SheetScrollLock) owns it against the
        // sheet's drag too.
        scrollEnabled={!scrollLocked}
        scrollEventThrottle={16}
        onLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          pull.current.viewport = height;
          if (height !== viewportHeight) setViewportHeight(height);
          settleSoon();
        }}
        // The rest position is the END of the scroll, and that moves whenever
        // the sheet changes height (the keyboard, a sub-mode). The jump here
        // can land before the new size has reached the native view, which left
        // the sheet short of open; the settle that follows measures and
        // finishes the job.
        onContentSizeChange={(_width, height) => {
          pull.current.content = height;
          if (pull.current.touching) return;
          outerRef.current?.scrollToEnd({ animated: false });
          settleSoon();
        }}
        onScroll={(event) => {
          pull.current.y = event.nativeEvent.contentOffset.y;
          // A flick: the fling has carried it far enough, so go now.
          if (
            !pull.current.touching &&
            pull.current.dragged &&
            pulled() > DISMISS_DISTANCE
          )
            settleRef.current();
          else settleSoon();
        }}
        // A drag that ends in a cancel never reports its end; the next touch
        // clears it, so the sheet cannot stay parked where it was left.
        onTouchStart={() => {
          pull.current.touching = false;
          pull.current.closingUntil = 0;
          settleSoon();
        }}
        {...dragHandlers}
      >
        {/* The screen-reader dismiss. A one-finger drag is a gesture TalkBack
            and VoiceOver claim for their own navigation, so the sheet's drag is
            not operable by either — this labelled Pressable is, and it is the
            only announced way out of a sheet apart from the OS back gesture. */}
        <Pressable
          style={{ height: viewportHeight }}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
        />
        {/* Keyboard-aware: a sheet containing a TextInput must ride above the
            keyboard, or the field it exists to expose is the one thing hidden.
            The bottom inset is dropped while the keyboard is up — the keyboard
            already covers the nav bar, so keeping it leaves a dead band. */}
        <Animated.View
          style={[
            styles.sheet,
            {
              marginBottom: keyboardHeight,
              // Lifting a tall sheet by the keyboard height would push its TOP
              // off the screen, taking whatever field is up there with it — the
              // exact field the user just tapped. Cap the height to what is left
              // above the keyboard instead, and let the inner ScrollView pan.
              maxHeight: keyboardUp
                ? viewportHeight - keyboardHeight - insets.top - spacing(2)
                : viewportHeight * 0.8,
              paddingBottom: spacing(3) + (keyboardUp ? 0 : insets.bottom),
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Hidden from assistive tech rather than labelled: it used to
              announce "Drag down to close", which is an instruction a screen
              reader cannot carry out — the one-finger drag never reaches the
              sheet. Announcing an action that cannot be performed is worse than
              announcing nothing; the backdrop above carries the real one. */}
          <View
            style={styles.handleHit}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.handle} />
          </View>
          {/* A way out you can SEE, top right, every time (UX §3): the drag, the
              backdrop and the system back are gestures, and a gesture is not a
              way out. Back, when there is one, sits on the same line at the
              left: a sub-mode's title IS what you are going back from, and a
              header slot may be empty, which left the arrow floating on its own
              row looking like a stray control. */}
          <View style={styles.titleRow}>
            {onBack ? (
              <IconButton
                icon="back"
                accessibilityLabel="Back"
                onPress={onBack}
              />
            ) : null}
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <IconButton
              icon="close"
              accessibilityLabel="Close"
              color={theme.text}
              onPress={onClose}
            />
          </View>
          {header != null ? <View style={styles.header}>{header}</View> : null}
          {/* flexShrink so the scroll area yields to the pinned footer under
              the sheet's maxHeight cap. Without it this wrapper claims the
              full content height and pushes the footer off-screen. */}
          <View style={styles.scrollArea}>
            <ScrollView
              ref={scrollRef}
              onLayout={(event) => {
                viewport.current = {
                  ...viewport.current,
                  height: event.nativeEvent.layout.height,
                };
              }}
              onScroll={(event) => {
                viewport.current = {
                  ...viewport.current,
                  y: event.nativeEvent.contentOffset.y,
                };
              }}
              scrollEventThrottle={32}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              // Without this the FIRST tap on any control while the keyboard is
              // up is swallowed dismissing it, and the button only fires on the
              // second press — which read as "Save didn't save".
              keyboardShouldPersistTaps="handled"
              // What this cannot scroll goes to the sheet's drag (see the top
              // of the file).
              nestedScrollEnabled
              {...dragHandlers}
              // Frozen while a sub-mode covers it: a drag on the overlay must
              // not scroll the list hidden behind it. Frozen too while a child
              // owns the current touch (SheetScrollLock).
              scrollEnabled={overlay == null && !scrollLocked}
            >
              <SheetScrollLock.Provider value={scrollLock}>
                <SheetErrorReveal.Provider value={revealError}>
                  {/* The frame an error measures itself against. Not
                      collapsable, or Android flattens it away. */}
                  <View ref={contentRef} collapsable={false}>
                    {children}
                  </View>
                </SheetErrorReveal.Provider>
              </SheetScrollLock.Provider>
            </ScrollView>
            {overlay != null ? (
              <View style={styles.overlay}>{overlay}</View>
            ) : null}
          </View>
          {footer != null ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: spacing(1) },
  scrollArea: { flexShrink: 1 },
  // Opaque, so the list it covers doesn't ghost through.
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: theme.page },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: scrim.light },
  dock: { flex: 1 },
  sheet: {
    backgroundColor: theme.page,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(2),
  },
  handleHit: { alignItems: "center", paddingVertical: spacing(1.5) },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: theme.lineStrong,
    opacity: 0.5,
  },
  // The row owns the bottom gap, so the arrow, the words and the × stay on a
  // single baseline. The × hangs into the sheet's padding to meet its corner.
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    marginBottom: spacing(1),
    marginRight: -spacing(1),
  },
  title: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: theme.text,
  },
  scrollContent: { paddingBottom: spacing(2) },
  // Hairline above the pinned action, so it reads as attached to the sheet
  // rather than floating over the last row.
  footer: {
    paddingTop: spacing(1.5),
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
});
