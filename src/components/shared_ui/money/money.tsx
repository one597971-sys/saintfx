import React from 'react';
import { formatMoney, getCurrencyDisplayCode } from '@/components/shared';
import useDisplayCurrency from '@/hooks/useDisplayCurrency';
import { formatKes, parseAmount } from '@/utils/display-currency';

type TMoneyProps = {
    amount: number | string;
    className: string;
    currency: string;
    has_sign: boolean;
    should_format: boolean;
    show_currency: boolean; // if true, append currency symbol
};

const Money = ({
    amount = 0,
    className,
    currency = 'USD',
    has_sign,
    should_format = true,
    show_currency = false,
}: Partial<TMoneyProps>) => {
    const { toDisplay } = useDisplayCurrency();

    let sign = '';
    if (Number(amount) && (Number(amount) < 0 || has_sign)) {
        sign = Number(amount) > 0 ? '+' : '-';
    }

    // if it's formatted already then don't make any changes unless we should remove extra -/+ signs
    const value = has_sign || should_format ? Math.abs(Number(amount)) : amount;

    // Display-only USD -> KSh conversion (account currency and trading stay in USD).
    const numeric = parseAmount(amount);
    const display = Number.isFinite(numeric) ? toDisplay(Math.abs(numeric), currency) : null;

    let final_amount: string | number;
    let currency_label: string;
    if (display?.converted) {
        final_amount = formatKes(display.value);
        currency_label = display.label;
    } else {
        final_amount = should_format ? formatMoney(currency, value, true, 0, 0) : value;
        currency_label = getCurrencyDisplayCode(currency);
    }

    return (
        <React.Fragment>
            <span>{has_sign && sign}</span>
            <span data-testid='dt_span' className={className}>
                {final_amount} {show_currency && currency_label}
            </span>
        </React.Fragment>
    );
};

export default React.memo(Money);
