import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { mediaCategory } from "@logjam/shared";

import { fontSize, fontWeight, radius, scrim, spacing, theme, withAlpha } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import type { MirrorMedia } from "../sync/mirrorStore";
import { IconButton } from "../ui";

/**
 * Full-screen viewer for a trip's or canyon's attachments.
 *
 * Paged, not single-item: you arrive from one thumbnail but you are looking
 * through a set, so it swipes horizontally between items and offers arrows for
 * the same move (a swipe is invisible to a first-time user, and one hand may be
 * holding a rope). A counter says where you are in the set.
 *
 * Each page resolves its own full-resolution file lazily and caches it, so
 * opening the viewer costs one download, not the whole trip's worth.
 *
 * PRIVACY: everything shown is already on the device; the viewer adds no
 * network access of its own beyond the authed media fetch the cache performs.
 */
export function MediaViewer({
  items,
  startIndex,
  onClose,
}: {
  items: MirrorMedia[];
  startIndex: number;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const width = Dimensions.get("window").width;
  const listRef = useRef<FlatList<MirrorMedia>>(null);
  const [index, setIndex] = useState(startIndex);

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };

  const go = (delta: number) => {
    const next = Math.min(items.length - 1, Math.max(0, index + delta));
    if (next === index) return;
    setIndex(next);
    listRef.current?.scrollToOffset({ offset: next * width, animated: true });
  };

  const current = items[index];

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <FlatList
          ref={listRef}
          data={items}
          horizontal
          pagingEnabled
          initialScrollIndex={startIndex}
          getItemLayout={(_data, itemIndex) => ({
            length: width,
            offset: width * itemIndex,
            index: itemIndex,
          })}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          // Only the visible page mounts a player; a mounted video decoder per
          // attachment would stall the whole viewer on a trip with several.
          renderItem={({ item, index: pageIndex }) => (
            <View style={{ width }}>
              <MediaPage item={item} active={pageIndex === index} />
            </View>
          )}
        />

        <View style={[styles.topBar, { paddingTop: insets.top + spacing(1) }]}>
          <Text style={styles.counter}>
            {items.length > 1 ? `${index + 1} / ${items.length}` : ""}
          </Text>
          <IconButton
            icon="x"
            accessibilityLabel="Close"
            color={theme.textPrimary}
            onPress={onClose}
          />
        </View>

        {/* Arrows sit at the vertical middle, over the media's own edges —
            along the bottom they land on a video's transport controls, which is
            the one place they must not be. `box-none` so the space between them
            still belongs to the page underneath. */}
        {items.length > 1 ? (
          <View style={styles.arrowRow} pointerEvents="box-none">
            <View style={styles.arrowSlot}>
              {index > 0 ? (
                <IconButton
                  icon="chevron-left"
                  accessibilityLabel="Previous attachment"
                  color={theme.textPrimary}
                  filled
                  onPress={() => go(-1)}
                />
              ) : null}
            </View>
            <View style={styles.arrowSlot}>
              {index < items.length - 1 ? (
                <IconButton
                  icon="chevron-right"
                  accessibilityLabel="Next attachment"
                  color={theme.textPrimary}
                  filled
                  onPress={() => go(1)}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing(1) }]}>
          <Text style={styles.caption} numberOfLines={1}>
            {current?.filename ?? ""}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

/** One page: resolves its own file, then renders by category. */
function MediaPage({ item, active }: { item: MirrorMedia; active: boolean }) {
  const [uri, setUri] = useState<string | null>(item.localDisplayPath ?? null);
  const [state, setState] = useState<"idle" | "loading" | "missing">(
    item.localDisplayPath ? "idle" : "loading",
  );
  const category = mediaCategory(item.mediaType);

  useEffect(() => {
    if (uri !== null) return;
    let cancelled = false;
    setState("loading");
    ensureDisplayCached(item.id)
      .then((cached) => {
        if (cancelled) return;
        if (cached) {
          setUri(cached);
          setState("idle");
        } else {
          setState("missing");
        }
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, uri]);

  if (state === "loading") {
    return (
      <View style={styles.page}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (state === "missing" || uri === null) {
    return (
      <View style={styles.page}>
        <Feather name="cloud-off" size={28} color={theme.textMuted} />
        <Text style={styles.notice}>
          Not downloaded to this phone yet. It will appear once you have signal.
        </Text>
      </View>
    );
  }

  if (category === "video") return <VideoPage uri={uri} active={active} />;

  if (category === "track") {
    return (
      <View style={styles.page}>
        <Feather name="map" size={28} color={theme.textMuted} />
        <Text style={styles.notice}>
          {item.filename ?? "Route file"}
        </Text>
        <Text style={styles.noticeMuted}>
          Open it on the map from the trip to see where it goes.
        </Text>
      </View>
    );
  }

  return <Image source={{ uri }} style={styles.image} resizeMode="contain" />;
}

/**
 * A video page. The player is created per page but only plays while the page is
 * the visible one — swiping away pauses it rather than leaving audio running
 * behind the next photo.
 */
function VideoPage({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  return (
    <VideoView
      style={styles.image}
      player={player}
      allowsFullscreen
      contentFit="contain"
      nativeControls
    />
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: scrim.photo },
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing(1),
    paddingHorizontal: spacing(4),
  },
  image: { flex: 1, width: "100%" },
  notice: { color: theme.textPrimary, fontSize: fontSize.base, textAlign: "center" },
  noticeMuted: { color: theme.textMuted, fontSize: fontSize.sm, textAlign: "center" },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing(1),
  },
  counter: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    backgroundColor: withAlpha(theme.primary, 0.6),
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.25),
    overflow: "hidden",
  },
  arrowRow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing(1),
  },
  arrowSlot: { width: 40 },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing(1),
  },
  caption: {
    flex: 1,
    textAlign: "center",
    color: theme.textMuted,
    fontSize: fontSize.sm,
  },
});
