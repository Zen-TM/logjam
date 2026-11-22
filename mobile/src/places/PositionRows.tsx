import { positionFacts, type MapPointCoord } from "@logjam/shared";

import { copyFact } from "../map/factStat";
import { useTheme } from "../theme";
import { Icon, Row } from "../ui";

/**
 * Under a place's Position heading: its coordinates, then its grid reference,
 * each a row that copies itself. The rows are `positionFacts`, the ones
 * "What is here?" opens with.
 */
export function PositionRows({
  point,
  onCopied,
  coordinatesLabel,
  coordinatesSubtitle,
}: {
  point: MapPointCoord;
  onCopied: (message: string) => void;
  /** What a screen reader hears for the coordinates row. */
  coordinatesLabel: string;
  /** Under the coordinates, such as the place's elevation. */
  coordinatesSubtitle?: string;
}) {
  const theme = useTheme();
  return (
    <>
      {positionFacts(point).map((fact) => {
        const coordinates = fact.key === "position";
        return (
          <Row
            key={fact.key}
            icon={coordinates ? "place" : "mgaGrid"}
            title={fact.value}
            titleParts={fact.parts}
            subtitle={coordinates ? coordinatesSubtitle : undefined}
            right={<Icon idea="copy" size={20} color={theme.textMuted} />}
            accessibilityLabel={
              coordinates ? coordinatesLabel : `${fact.label}: ${fact.value}`
            }
            onPress={fact.copy ? copyFact(fact.copy, onCopied) : undefined}
          />
        );
      })}
    </>
  );
}
