"use client";

import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { CheckIcon } from "./icons";

/**
 * The tick-and-Continue pop-up from the Pop-ups design ("Account created",
 * "Welcome back", "Password changed"). The thing it reports has already
 * happened, so Esc and the backdrop continue too: there's nothing to cancel.
 */
export function SuccessDialog({
  open,
  title,
  body,
  onContinue,
  continueLabel = "Continue",
}: {
  open: boolean;
  title: string;
  body: string;
  onContinue: () => void;
  continueLabel?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onContinue}
      icon={<CheckIcon size={38} />}
      title={title}
      description={body}
      footer={
        <Button onClick={onContinue} size="lg" block autoFocus>
          {continueLabel}
        </Button>
      }
    />
  );
}
