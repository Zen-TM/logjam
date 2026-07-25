import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, fontWeight, radius, scrim, spacing, theme } from "../theme";

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
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // The bottom inset clears the nav bar — but the keyboard already covers it,
  // so keeping it while typing leaves a dead band under the form.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardUp(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  // Kept mounted through the close animation, then torn down.
  const [mounted, setMounted] = useState(visible);
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
      if (finished) setMounted(false);
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
          keyboard, or the field it exists to expose is the one thing hidden. */}
      <KeyboardAvoidingView
        style={styles.dock}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheet,
            {
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
        </Animated.View>
      </KeyboardAvoidingView>
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
    maxHeight: "80%",
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
});
