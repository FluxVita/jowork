import { useBilling } from './hooks/useBilling';

/** Plan comparison cards with upgrade buttons. */
export function PlanSelector() {
  const { plans, currentPlan, openCheckout } = useBilling();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlan;
        return (
          <div
            key={plan.id}
            className={`rounded-lg border p-4 flex flex-col ${
              isCurrent ? 'border-accent bg-accent/5' : 'border-border bg-surface'
            }`}
          >
            <div className="mb-3">
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="text-2xl font-bold mt-1">
                ${plan.price}
                <span className="text-sm font-normal text-text-secondary">/mo</span>
              </p>
              {plan.creditsPerMonth && (
                <p className="text-xs text-text-secondary mt-1">
                  {plan.creditsPerMonth.toLocaleString()} credits/month
                </p>
              )}
            </div>
            <ul className="flex-1 space-y-1.5 mb-4">
              {plan.features.map((f) => (
                <li key={f} className="text-sm text-text-secondary flex items-start gap-1.5">
                  <span className="text-accent mt-0.5">+</span>
                  {f}
                </li>
              ))}
            </ul>
            {isCurrent ? (
              <div className="text-center text-sm text-accent font-medium py-2">
                Current Plan
              </div>
            ) : (
              <button
                onClick={() => openCheckout(plan.id)}
                className="w-full py-2 rounded-md text-sm font-medium bg-accent text-white hover:bg-accent/90 transition-colors"
              >
                {plan.price === 0 ? 'Downgrade' : 'Upgrade'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
