"""POST /ecpay-return — ECPay ReturnURL (server-to-server), first 定期定額 charge.
Source of truth for activation: CMV-verified RtnCode=1 → active + current_period_end, welcome email queued."""
import ecpay_common as ec


def handler(event, context):
    return ec.handle_callback(event, "return")
