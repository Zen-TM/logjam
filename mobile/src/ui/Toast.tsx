import {
  runToastAction,
  toastGlyph,
  toastMs,
  type ToastAction,
  type ToastTone,
} from "@logjam/shared";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";

import { radius, spacing, makeStyles, useTheme } from "../theme";
import { Icon } from "./Icon";
import { useReducedMotionRef } from "./useReducedMotion";
import { useTabBarHeight } from "./tabBar";
import { claimsHorizontalDrag, swipeDismisses } from "./toastSwipe";
import { createToastQueue } from "./toastStore";

export type ToastMessage = {
  text: string;
  tone: ToastTone;
  /** The toast reports no outcome (an instruction, a notice): no check glyph. */
  informs?: boolean;
  /** The one thing the outcome offers ("Undo", "Open"); pressing it dismisses. */
  action?: ToastAction;
  /** Bump on every new message so a repeat of the same text re-shows + re-times. */
  nonce: number;
};

// One host, one anchor (DESIGN.md): every `<Toast>` publishes to this queue and
// `ToastHost`, mounted once at the shell, draws the one showing, centred above
// the tab bar. A toast is therefore the same place whichever screen raised it,
// and no screen or sheet can move it (`toastHost.test.ts`).
const TOAST_MAX_WIDTH = 480;
const queue = createToastQueue();

/**
 * Transient status, centred above the tab bar: the outcome of an action the
 * user just took (imported, saved, couldn't reach the server).
 *
 * Toasts, not inline cards: an inline banner reflows the list under the user's
 * thumb and then lingers with no owner. Errors stay up longer than
 * confirmations, and both are announced to screen readers.
 *
 * A screen keeps its message in state and renders `<Toast>`, which draws
 * nothing itself: `ToastHost` does, one at a time, in the order they came
 * (`toastStore.ts`). Only the pill takes touches (the dock around it is
 * `box-none`), so it never eats a tap beside itself. It can be cleared early:
 * swipe it sideways (a bottom-docked pill, and vertical belongs to the sheets
 * and the map), or press its × — the visible way out a screen reader and a
 * thumb both reach.
 */
export function Toast({
  message,
  onDismissed,
}: {
  message: ToastMessage | null;
  onDismissed: () => void;
}) {
  const [owner] = useState(() => Symbol("toast"));
  const hosted = useSyncExternalStore(queue.subscribe, queue.hosted);
  useEffect(() => {
    if (hosted && message) queue.publish({ owner, message, onDismissed });
    // Raised when the message changes, once; the callback is a fresh closure
    // each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, message, owner]);
  // No host mounted (a test, a screen outside the shell): draw it in place.
  return hosted ? null : (
    <ToastDock message={message} onDismissed={onDismissed} />
  );
}

/**
 * Mounted once at the shell root, above the navigator, and once more inside
 * each open modal sheet: a native Modal draws over everything under it, the
 * shell's host included, so the newest host is the only one that draws
 * (`toastStore.topHost`). Both dock in the same place, so a toast does not jump
 * when a sheet opens.
 */
export function ToastHost() {
  const [id] = useState(() => Symbol("host"));
  useEffect(() => queue.mountHost(id), [id]);
  const current = useSyncExternalStore(queue.subscribe, queue.current);
  const top = useSyncExternalStore(queue.subscribe, queue.topHost);
  return (
    <ToastDock
      message={top === id ? (current?.message ?? null) : null}
      onDismissed={queue.dismiss}
    />
  );
}

function ToastDock({
  message,
  onDismissed,
}: {
  message: ToastMessage | null;
  onDismissed: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const bottom = spacing(2) + useTabBarHeight();

  const [opacity] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(12));
  const [slide] = useState(() => new Animated.Value(0));
  const dismissed = useEffectEvent(onDismissed);
  const reduced = useReducedMotionRef();
  // The PanResponder below lives for the component's life, so it reads the
  // latest callback through a ref (an Effect Event cannot be called from it).
  const latest = useRef(onDismissed);
  useEffect(() => {
    latest.current = onDismissed;
  });
  // Created once: a rebuilt PanResponder swaps handlers mid-drag.
  // eslint-disable-next-line react-hooks/refs -- `latest` is read only on release, never in render
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => claimsHorizontalDrag(g.dx, g.dy),
      onPanResponderMove: (_e, g) => slide.setValue(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (swipeDismisses(g.dx, g.vx)) {
          Animated.timing(slide, {
            toValue: Math.sign(g.dx || g.vx) * 400,
            duration: reduced.current ? 0 : 160,
            useNativeDriver: true,
          }).start(() => latest.current());
        } else {
          Animated.spring(slide, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  );

  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    lift.setValue(12);
    slide.setValue(0);
    const still = reduced.current;
    const show = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: still ? 0 : 160,
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }),
    ]);
    if (still) lift.setValue(0);
    show.start();
    const timer = setTimeout(
      () => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: still ? 0 : 220,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) dismissed();
        });
      },
      toastMs(message.tone, message.action),
    );
    return () => {
      show.stop();
      clearTimeout(timer);
    };
    // Keyed on nonce so the same text fired twice replays the animation.
  }, [lift, message, opacity, reduced, slide]);

  if (!message) return null;
  const error = message.tone === "error";

  return (
    <View style={[styles.dock, { bottom }]} pointerEvents="box-none">
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        {...pan.panHandlers}
        style={[
          styles.toast,
          error ? styles.toastError : styles.toastInfo,
          { opacity, transform: [{ translateY: lift }, { translateX: slide }] },
        ]}
      >
        <Icon
          idea={toastGlyph(message.tone, message.informs)}
          size={16}
          color={theme.onInverse}
        />
        <Text style={styles.text}>{message.text}</Text>
        {message.action ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              if (message.action) runToastAction(message.action, onDismissed);
            }}
          >
            <Text style={styles.action}>{message.action.label}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={12}
          onPress={onDismissed}
          style={styles.close}
        >
          <Icon idea="close" size={16} color={theme.onInverse} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  dock: {
    position: "absolute",
    left: spacing(2),
    right: spacing(2),
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingVertical: spacing(1.5),
    paddingHorizontal: spacing(2),
    maxWidth: TOAST_MAX_WIDTH,
  },
  // The inverted surface, as on Logjam Web: the glyph's SHAPE says error or
  // not, because an intent colour on the inverse fails 3:1 in a dark scheme.
  toastInfo: { backgroundColor: theme.inverse, borderColor: theme.inverse },
  toastError: { backgroundColor: theme.inverse, borderColor: theme.inverse },
  close: { marginLeft: spacing(0.5) },
  text: { ...textRole.control, flexShrink: 1, color: theme.onInverse },
  action: {
    ...textRole.control,
    color: theme.onInverse,
    textDecorationLine: "underline",
  },
}));
