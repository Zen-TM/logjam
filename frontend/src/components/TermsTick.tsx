import { Checkbox } from "../ui";
import { Rich } from "../ui/rich";
import { rich } from "@logjam/shared";

function DocLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** The agreement tick, on the sign-up form and in ConsentGate. */
function TermsTick({
  updated = false,
  checked,
  onChange,
}: {
  /** The terms changed since this account agreed to them. */
  updated?: boolean;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const tags = {
    tos: (text: string) => <DocLink href="/tos.html">{text}</DocLink>,
    privacy: (text: string) => <DocLink href="/privacy.html">{text}</DocLink>,
  };
  const parts = updated
    ? rich`I agree to the updated <tos>Terms</tos> and acknowledge the <privacy>Privacy Policy</privacy>.`
    : rich`I agree to the <tos>Terms of Use</tos> and acknowledge the <privacy>Privacy Policy</privacy>.`;
  return (
    <Checkbox
      labelHasLinks
      label={<Rich parts={parts} tags={tags} />}
      checked={checked}
      onChange={onChange}
    />
  );
}

export default TermsTick;
