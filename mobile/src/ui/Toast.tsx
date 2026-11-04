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
import { useTabBarHeight } from "./tabBar";
import { claimsHorizontalDrag, swipeDismisses } from "./toastSwipe";

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

type Clearance = {
  /** How far above the tab bar the toast docks, for a screen that keeps its own
   *  instruments there (the map's scale bar). */
  bottom?: number;
  /** Kept free on BOTH sides, so the toast stays centred while it clears a
   *  column on one of them (the map's actions). */
  inset?: number;
};

type Shown = {
  owner: symbol;
  message: ToastMessage;
  onDismissed: () => void;
} & Clearance;

// One host, one anchor (DESIGN.md): every `<Toast>` publishes here and
// `ToastHost`, mounted once at the shell, draws it centred above the tab bar.
// A screen's toast is therefore the same place whichever screen raised it.
let shown: Shown | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * Transient status, centred above the tab bar — the outcome of an
 * action the user just took (imported, saved, couldn't reach the server). — the outcome of an
 * action the user just took (imported, saved, couldn't reach the server).
 *
 * Toasts, not inline cards: an inline banner reflows the list under the user's
 * thumb and then lingers with no owner. Errors stay up longer than
 * confirmations, and both are announced to screen readers.
 *
 * A screen keeps its message in state and renders `<Toast>`, which draws
 * nothing itself: `ToastHost` does. Only the pill takes touches (the dock
 * around it is `box-none`), so it never eats a tap beside itself. It can be
 * cleared early: swipe it sideways (a bottom-docked pill, and vertical
 * belongs to the sheets and the map), or press its × — the visible way out a
 * screen reader and a thumb both reach.
 */
export function Toast({
  message,
  onDismissed,
  bottom,
  inset,
}: { message: ToastMessage | null; onDismissed: () => void } & Clearance) {
  const [owner] = useState(() => Symbol("toast"));
  const hosted = useSyncExternalStore(subscribe, () => hosts > 0);
  useEffect(() => {
    if (!hosted) return;
    if (message) shown = { owner, message, onDismissed, bottom, inset };
    else if (shown?.owner === owner) shown = null;
    else return;
    emit();
    // `onDismissed` is a fresh closure every render; the message is the change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hosted, message, owner, bottom, inset]);
  // No host mounted (a test, a screen outside the shell): draw it in place.
  return hosted ? null : (
    <ToastDock
      message={message}
      onDismissed={onDismissed}
      bottom={bottom}
      inset={inset}
    />
  );
}

/** Mounted once, at the shell root, above the navigator: the only anchor. */
export function ToastHost() {
  useEffect(() => {
    hosts += 1;
    emit();
    return () => {
      hosts -= 1;
      emit();
    };
  }, []);
  const current = useSyncExternalStore(subscribe, () => shown);
  const tabBar = useTabBarHeight();
  return (
    <ToastDock
      message={current?.message ?? null}
      onDismissed={() => {
        const dismissOwner = current?.onDismissed;
        shown = null;
        emit();
        dismissOwner?.();
      }}
      bottom={(current?.bottom ?? 0) + tabBar}
      inset={current?.inset}
    />
  );
}

function ToastDock({
  message,
  onDismissed,
  bottom,
  inset,
}: {
  message: ToastMessage | null;
  onDismissed: () => void;
} & Clearance) {
  const theme = useTheme();
  const styles = useStyles();

  const [opacity] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(12));
  const [slide] = useState(() => new Animated.Value(0));
  const dismissed = useEffectEvent(onDismissed);
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
            duration: 160,
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
    const show = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.spring(lift, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }),
    ]);
    show.start();
    const timer = setTimeout(
      () => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
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
  }, [lift, message, opacity, slide]);

  if (!message) return null;
  const error = message.tone === "error";

  return (
    <View
      style={[
        styles.dock,
        bottom != null && { bottom: spacing(2) + bottom },
        inset != null && { left: inset, right: inset },
      ]}
      pointerEvents="box-none"
    >
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
    bottom: spacing(2),
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
    maxWidth: "100%",
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
