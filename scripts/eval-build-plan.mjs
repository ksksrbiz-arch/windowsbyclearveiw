import assert from 'node:assert/strict';
import { lintPlan } from '../functions/_lib/build-plan-rules.mjs';

const base = {
  openings: [{ product:'Cascade double-hung', openingType:'double-hung', dimensions:'VERIFY at site' }],
  buy: ['Quoted window unit — quote-derived: verify against order confirmation'],
  verify: [
    'Manufacturer-specific installation and flashing instructions available for the selected product',
    'Fastener type, length, diameter, spacing and support requirements verified from product instructions',
    'Flashing/sill/water-management sequence verified for the wall and opening conditions',
    'Confirm weep/drainage paths remain clear',
  ],
  install: ['FASTEN: Use the selected product installation instructions.'],
  qc: ['Unit operates, locks and latches correctly'],
};

const safe = lintPlan(base, [{ label:'Cascade double-hung', quantity:1, description:'' }]);
assert.equal(safe.blockers.length, 0);

const inventedFastener = lintPlan({ ...base, install:['Fasten with #8 x 3 inch screws at 8 inches O.C.'] }, [{ label:'Cascade double-hung', quantity:1 }]);
assert.ok(inventedFastener.blockers.some(x => /fastener|spacing/i.test(x)));

const noWater = lintPlan({ ...base, verify: ['Manufacturer-specific installation instructions available.'] }, [{ label:'Cascade double-hung', quantity:1 }]);
assert.ok(noWater.blockers.some(x => /water-management/i.test(x)));

const wrongQty = lintPlan(base, [{ label:'Cascade double-hung', quantity:2 }]);
assert.ok(wrongQty.warnings.some(x => /quantity/i.test(x)));

console.log('Build Plan rules: PASS');
