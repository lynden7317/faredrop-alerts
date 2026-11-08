"""POST /ecpay-period — ECPay PeriodReturnURL, every renewal from the 2nd charge on.
Success extends current_period_end; failures are counted and only the 6th consecutive one expires."""
import ecpay_common as ec


def handler(event, context):
    return ec.handle_callback(event, "period")
