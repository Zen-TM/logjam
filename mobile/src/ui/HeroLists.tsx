import { Animated, FlatList, ScrollView, SectionList } from "react-native";

/**
 * The lists under a `CollapsingHeader`. Only an animated component hands its
 * scroll to the native driver (`useHeroCollapse`); the cast keeps each list's
 * own item typing, which `Animated.FlatList` and its siblings drop.
 */
export const HeroFlatList = Animated.createAnimatedComponent(
  FlatList,
) as unknown as typeof FlatList;
export const HeroSectionList = Animated.createAnimatedComponent(
  SectionList,
) as unknown as typeof SectionList;
export const HeroScrollView = Animated.createAnimatedComponent(
  ScrollView,
) as unknown as typeof ScrollView;
