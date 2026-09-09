// Deterministic ICM router for public Ask and internal AI surfaces.
// This is routing, not reasoning. It chooses one specialist contract before
// the model is called; the model remains responsible for judgment within that
// bounded context. Keep this file dependency-free and easy to test.

const PUBLIC_ROUTES = [
  { id: 'diagnostician', specialist: '.ai/specialists/diagnostician', test: /\b(fog|fogged|draft|drafty|condensation|rot|rotted|leak|leaking|water damage|broken|crack|mold|moisture|failed seal|air leak)\b/i },
  { id: 'estimator', specialist: '.ai/specialists/estimator', test: /\b(estimate|quote|bid|proposal|cost|price|pricing|budget|how much|afford)\b/i },
  { id: 'installation-reviewer', specialist: '.ai/specialists/installation-reviewer', test: /\b(install|installation|flashing|rough opening|opening prep|nail fin|fastener|sealant|shim|water management|new construction)\b/i },
  { id: 'customer-advisor', specialist: '.ai/specialists/customer-advisor', test: /\b(compare|comparison|difference|versus|vs\.?|better|which|choose|style|appearance|energy|efficient|u-factor|shgc|low-e|what should i|what do i need)\b/i },
];

const INTERNAL_ROUTES = [
  { id: 'lead-analyzer', specialist: '.ai/specialists/lead-analyzer', test: /\b(analyze|analysis|qualify|qualification|lead|prospect|follow[- ]?up|followup|inquiry)\b/i },
  { id: 'evidence-reviewer', specialist: '.ai/specialists/evidence-reviewer', test: /\b(evidence|photo review|photo evidence|field evidence|closeout evidence|inspection evidence|proof|verify evidence)\b/i },
  { id: 'operations-copilot', specialist: '.ai/specialists/operations-copilot', test: /\b(command center|operations|operational|dashboard|today|workload|backlog|stale|blocked|blocker|what needs attention)\b/i },
  { id: 'knowledge-assistant', specialist: '.ai/specialists/knowledge-assistant', test: /\b(knowledge|policy|procedure|guide|reference|how does clearview|internal guidance|what does our)\b/i },
  { id: 'visualizer', specialist: '.ai/specialists/visualizer', test: /\b(visualize|visualizer|render|rendering|mockup|mock-up|appearance preview|design preview)\b/i },
];

export function routeAsk({ message = '', project = {}, surface = 'ask' } = {}) {
  const text = String(message).trim();
  const internal = surface === 'internal';
  const routes = internal ? [...INTERNAL_ROUTES, ...PUBLIC_ROUTES] : PUBLIC_ROUTES;

  // Internal-only intents are checked first only on the authenticated internal
  // surface. Public /ask cannot accidentally route into internal contracts.
  if (internal) {
    for (const route of INTERNAL_ROUTES) {
      if (route.test.test(text)) return { ...route, reason: 'explicit-message-match' };
    }
  }

  // Specific public routes win over weak generic phrasing and project context.
  for (const route of PUBLIC_ROUTES.slice(0, -1)) {
    if (route.test.test(text)) return { ...route, reason: 'explicit-message-match' };
  }
  if (project?.concern === 'Fogged glass' || project?.concern === 'Drafts' || project?.concern === 'Damage') {
    return { ...PUBLIC_ROUTES[0], reason: 'project-context' };
  }
  if (project?.projectStage === 'Ready for estimate') return { ...PUBLIC_ROUTES[1], reason: 'project-stage' };
  const advisor = PUBLIC_ROUTES[PUBLIC_ROUTES.length - 1];
  if (advisor.test.test(text)) {
    return { ...advisor, reason: 'explicit-message-match' };
  }
  return { ...advisor, reason: 'default-advisor' };
}

export function routeSummary(route) {
  return `ICM route: ${route.id} (${route.reason})`;
}

export const ICM_ROUTES = [...PUBLIC_ROUTES, ...INTERNAL_ROUTES].map(({ id, specialist }) => ({ id, specialist }));
