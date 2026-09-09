// Deterministic ICM router for the public Ask assistant.
// This is routing, not reasoning. It chooses one specialist contract before
// the model is called; the model remains responsible for judgment within that
// bounded context. Keep this file dependency-free and easy to test.

const ROUTES = [
  { id: 'diagnostician', specialist: '.ai/specialists/diagnostician', test: /\b(fog|fogged|draft|drafty|condensation|rot|rotted|leak|leaking|water damage|broken|crack|mold|moisture|failed seal|air leak)\b/i },
  { id: 'estimator', specialist: '.ai/specialists/estimator', test: /\b(estimate|quote|bid|proposal|cost|price|pricing|budget|how much|afford)\b/i },
  { id: 'installation-reviewer', specialist: '.ai/specialists/installation-reviewer', test: /\b(install|installation|flashing|rough opening|opening prep|nail fin|fastener|sealant|shim|water management|new construction)\b/i },
  { id: 'customer-advisor', specialist: '.ai/specialists/customer-advisor', test: /\b(compare|comparison|difference|versus|vs\.?|better|which|choose|style|appearance|energy|efficient|u-factor|shgc|low-e|what should i|what do i need)\b/i },
];

export function routeAsk({ message = '', project = {} } = {}) {
  const text = String(message).trim();
  for (const route of ROUTES) {
    if (route.test.test(text)) {
      return { ...route, reason: 'explicit-message-match' };
    }
  }
  if (project?.concern === 'Fogged glass' || project?.concern === 'Drafts' || project?.concern === 'Damage') {
    return { ...ROUTES[0], reason: 'project-context' };
  }
  if (project?.projectStage === 'Ready for estimate') return { ...ROUTES[1], reason: 'project-stage' };
  return { ...ROUTES[3], reason: 'default-advisor' };
}

export function routeSummary(route) {
  return `ICM route: ${route.id} (${route.reason})`;
}

export const ICM_ROUTES = ROUTES.map(({ id, specialist }) => ({ id, specialist }));
