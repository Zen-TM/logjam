import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, fontWeight, radius, scrim, spacing, theme, withAlpha } from "../theme";

// Slide-up modal sheet with a draggable handle + title, capped at 80% height
// and scrolling within.
//
// Motion: the backdrop FADES while the sheet SLIDES (RN's
// `animationType="slide"` animates the whole modal, dragging the scrim up from
// the bottom with it, which reads as one moving slab instead of a dimmed
// screen). Hence `animationType="none"` plus two driven values.
//
// The handle is real: drag it down past ~120pt (or flick it) to dismiss,
// otherwise it springs back. An affordance that doesn't respond is worse than
// no affordance. The PanResponder is bound to the handle only, so the sheet's
// inner ScrollView keeps its own gestures.
//
// Coverage: `statusBarTranslucent` + `navigationBarTranslucent` put the scrim
// behind BOTH system bars, and the sheet carries the bottom inset in its own
// padding — so its surface runs to the physical bottom edge instead of
// stopping on the tab bar's colour.
const SHEET_TRAVEL = Dimensions.get("window").height;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1.2;

export function BottomSheet({
  visible,
  onClose,
  onClosed,
  title,
  footer,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
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
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
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
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const keyboardUp = keyboardHeight > 0;
  // Kept mounted through the close animation, then torn down.
  const [mounted, setMounted] = useState(visible);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      drag.setValue(0);
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
      onClosedRef.current?.();
    });
  }, [drag, progress, visible]);



  // The PanResponder is created once; route its release through a ref so it
  // always calls the current onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handlePan = useRef(
    PanResponder.create({
      // Claim on touch-down: the handle has nothing else to do with a touch,
      // and waiting for a move lets a fast flick start before we own the
      // responder (the gesture then never reaches us at all).
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        drag.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > DISMISS_DISTANCE || gesture.vy > DISMISS_VELOCITY) {
          onCloseRef.current();
          return;
        }
        Animated.spring(drag, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  const translateY = Animated.add(
    progress.interpolate({ inputRange: [0, 1], outputRange: [SHEET_TRAVEL, 0] }),
    drag,
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.backdropPress} onPress={onClose} />
      </Animated.View>
      {/* Keyboard-aware: a sheet containing a TextInput must ride above the
          keyboard, or the field it exists to expose is the one thing hidden.
          The bottom inset is dropped while the keyboard is up — the keyboard
          already covers the nav bar, so keeping it leaves a dead band. */}
      <View style={styles.dock} pointerEvents="box-none">
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
                ? SHEET_TRAVEL - keyboardHeight - insets.top - spacing(2)
                : "80%",
              paddingBottom: spacing(3) + (keyboardUp ? 0 : insets.bottom),
              transform: [{ translateY }],
            },
          ]}
        >
          <View
            style={styles.handleHit}
            accessibilityRole="adjustable"
            accessibilityLabel="Drag down to close"
            {...handlePan.panHandlers}
          >
            <View style={styles.handle} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer != null ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: scrim.light },
  backdropPress: { flex: 1 },
  dock: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.primary,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(2),
  },
  handleHit: { alignItems: "center", paddingVertical: spacing(1.5) },
  handle: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: theme.bonus1,
    opacity: 0.5,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: theme.textPrimary,
    marginBottom: spacing(1),
  },
  scrollContent: { paddingBottom: spacing(2) },
  // Hairline above the pinned action, so it reads as attached to the sheet
  // rather than floating over the last row.
  footer: {
    paddingTop: spacing(1.5),
    borderTopWidth: 1,
    borderTopColor: withAlpha(theme.bonus1, 0.2),
  },
});
