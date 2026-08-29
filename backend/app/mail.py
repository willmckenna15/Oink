"""Sending account email.

There is no mail provider wired up, and picking one is a commercial decision
rather than a technical one. So delivery is a seam: the flows below are written
against `send`, and swapping the console backend for a real provider is one
function, not a rewrite of the reset flow.

Until MAIL_BACKEND is set to something else, mail is written to the log. That is
correct for local development and *deliberately loud* in production — a reset
link sitting in your server log is a security problem, so it says so.
"""

import logging

from . import config

logger = logging.getLogger("oink.mail")


def send(to: str, subject: str, body: str) -> None:
    if config.MAIL_BACKEND == "console":
        if not config.PUBLIC_BASE_URL.startswith("http://localhost"):
            logger.error(
                "MAIL_BACKEND is still 'console' outside local development. "
                "Account email is being written to the log instead of sent, "
                "which puts reset links in your logs. Configure a provider."
            )
        logger.info("--- email to %s ---\n%s\n\n%s\n--- end ---", to, subject, body)
        return

    raise NotImplementedError(
        f"MAIL_BACKEND={config.MAIL_BACKEND!r} has no implementation yet. "
        "Add the provider call here; the flows upstream need no changes."
    )


def send_password_reset(to: str, display_name: str, link: str) -> None:
    send(
        to,
        "Reset your Oink password",
        f"Hello {display_name},\n\n"
        f"Somebody asked to reset the password on your Oink account. If that was\n"
        f"you, follow this link within {config.RESET_TOKEN_HOURS} hours:\n\n"
        f"    {link}\n\n"
        f"If it wasn't you, ignore this — your password hasn't changed.\n",
    )


def send_email_verification(to: str, display_name: str, link: str) -> None:
    send(
        to,
        "Confirm your email for Oink",
        f"Hello {display_name},\n\n"
        f"Confirm this address so you can get back in if you forget your\n"
        f"password:\n\n"
        f"    {link}\n",
    )
