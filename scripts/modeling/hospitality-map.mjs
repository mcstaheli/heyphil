// Builds the HeyPhil Map for the Hospitality Model template and writes it
// (plus the extra named ranges it needs) into a template copy HeyPhil made.
//
//   node scripts/modeling/hospitality-map.mjs <spreadsheetId>          dry run: prints what it would write
//   node scripts/modeling/hospitality-map.mjs <spreadsheetId> --write  writes it
//
// Goes through server/modeling/drive-guard.js, so it can only touch a file
// inside the HeyPhil folder that HeyPhil itself created.
//
// The map (one row per item) is what HeyPhil reads to ask questions and
// show results. Columns:
//   Key      stable id (usually the named range)
//   Kind     step | input | list | grid | target | output
//   Target   the named range it reads/writes
//   Step     which step of the intake (or output group)
//   Level    quick (napkin) | standard | detail   - outputs: headline | detail
//   Order    sort order within the step
//   Question the question / label
//   Help     help text
//   Type     currency | percent | integer | number | multiple | month | text | choice
//   Options  choices (a|b|c), row labels for a list, column spec for a grid,
//            or for a target: the output it aims at
//   Show if  only ask when another answer matches (key=value)
//   Notes    "calculated" = the template computes it; HeyPhil keeps the
//            formula unless someone overrides it
import 'dotenv/config';
import * as g from '../../server/modeling/drive-guard.js';
import { sheetSafe } from '../../server/modeling/rules.js';

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const RAMP = Array.from({ length: 36 }, (_, i) => `Month ${i + 1}`).join('|');
const NEWKEY_RAMP = Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`).join('|');
const YEARS8 = Array.from({ length: 8 }, (_, i) => `Year ${i + 1}`).join('|');
const OPEX_METHODS = 'Fixed Annual $|$ per Month|% of Total Revenue|% of Rooms Revenue|% of Dept Revenue|$ per Available Room Night|$ per Occupied Room Night|Detail Build-up';
const DRIVERS = 'Rooms Revenue|Total Revenue|F&B Revenue|Other Dept Revenue';
const OPEX_CATS = 'Rooms|Food & Beverage|Other Operated Departments|Administrative & General|Information & Telecom System|Sales & Marketing|Franchise / Brand Fees|Property Operations & Maintenance|Utilities|Credit Card Fees|Management Fee|Property Taxes|Insurance|Ground Rent / Other Non-Operating';
const DEV_CATS = 'Guestrooms|Corridors & Public Space|Food & Beverage / Retail|Exterior & Site|MEP, Roof & Life Safety|FF&E & Case Goods|Technology & Systems|Signage & Branding|Soft Costs & Fees|Contingency|Brand Incentive / Key Money|New Keys / Expansion';

// [step key, title, intro]
const STEPS = [
  ['basics', 'Deal basics', 'The property, when the model starts, and how cash is handled.'],
  ['acquisition', 'Acquisition & closing', 'What it costs to buy and close.'],
  ['revenue', 'Rooms revenue', 'Stabilized occupancy and rate. Quick answers scale the template\'s monthly seasonality curve.'],
  ['ramp', 'Ramp-up', 'How performance builds from takeover (or re-opening) to stabilized.'],
  ['capital', 'Renovation & capital', 'Shutdown phases, the capital budget and the FF&E reserve.'],
  ['newkeys', 'New keys', 'Keys added (or removed) and how they ramp.'],
  ['other_revenue', 'Other revenue', 'F&B, other departments, miscellaneous and lease income.'],
  ['opex', 'Operating expenses', 'The USALI expense build. Defaults are the template\'s market assumptions.'],
  ['debt', 'Financing', 'How the loan is sized and priced.'],
  ['equity', 'Equity & waterfall', 'Who puts in the equity and how cash is split.'],
  ['exit', 'Exit', 'When and how the asset is sold.'],
  ['tax', 'Tax & depreciation', 'Hypothetical tax view for LPs (illustration only).'],
];

// [key/target, kind, step, level, question, help, type, options, showIf, notes]
const INPUTS = [
  // basics
  ['in_deal_name', 'input', 'basics', 'quick', 'What\'s the property or deal called?', '', 'text'],
  ['in_model_start_date', 'input', 'basics', 'quick', 'What month does the model start?', 'Always the first of a month. Usually the expected close or takeover month.', 'month'],
  ['in_existing_keys', 'input', 'basics', 'quick', 'How many keys (rooms) does it have today?', '', 'integer'],
  ['in_opening_cash', 'input', 'basics', 'standard', 'Opening cash in the property account', '', 'currency'],
  ['in_min_cash_balance', 'input', 'basics', 'standard', 'Minimum cash balance to keep', 'Distributions never take cash below this.', 'currency'],
  ['in_distribute_cash_above', 'input', 'basics', 'standard', 'Distribute cash above', 'Once cash on hand exceeds this, the excess goes to partners (after the minimum balance).', 'currency'],
  ['in_first_distribution_date', 'input', 'basics', 'standard', 'First month distributions can be paid', 'No distributions before this date, even if cash is above the trigger.', 'month'],
  // acquisition
  ['in_purchase_price', 'input', 'acquisition', 'quick', 'Purchase price (or loan payoff)', 'Contract price, before closing costs.', 'currency'],
  ['in_closing_cost_pct', 'input', 'acquisition', 'standard', 'Closing costs as a % of price', '', 'percent'],
  ['in_other_closing_costs', 'input', 'acquisition', 'standard', 'Other closing costs ($)', 'Legal, title, transfer tax, lender legal - anything quoted in dollars rather than as a %.', 'currency'],
  ['in_expense_reimbursement', 'input', 'acquisition', 'standard', 'Expense reimbursement', 'Set to 0 when a deal has none - zero is the off switch.', 'currency'],
  ['in_working_capital', 'input', 'acquisition', 'standard', 'Working capital funded at close', '', 'currency'],
  ['in_philo_basis_left_in', 'input', 'acquisition', 'detail', 'Philo basis left in (in-kind LP contribution, at cost)', '', 'currency'],
  // revenue
  // targets aim at the ADJUSTED averages (H50/H51), not the raw curve's
  ['target_occupancy', 'target', 'revenue', 'quick', 'Stabilized occupancy (annual average)', 'HeyPhil scales the template\'s monthly occupancy curve so the year averages this (busy months cap at 100%).', 'percent', 'out_adjusted_occupancy', '', 'writes in_occupancy_adjustment'],
  ['target_adr', 'target', 'revenue', 'quick', 'Stabilized ADR (annual average, today\'s dollars)', 'HeyPhil scales the template\'s monthly ADR curve so the year averages this.', 'currency', 'out_adjusted_adr', '', 'writes in_adr_adjustment'],
  ['in_season_occupancy', 'list', 'revenue', 'detail', 'Stabilized occupancy by month', 'A typical stabilized year, before ramp-up.', 'percent', MONTHS],
  ['in_season_adr', 'list', 'revenue', 'detail', 'Stabilized ADR by month', 'Today\'s dollars, before growth.', 'currency', MONTHS],
  ['in_flat_occupancy', 'input', 'revenue', 'detail', 'Flat annual occupancy (optional)', 'Fill this instead of the twelve months and the curve goes flat. Leave blank to use the monthly curve.', 'percent'],
  ['in_flat_adr', 'input', 'revenue', 'detail', 'Flat annual ADR (optional)', 'Fill this instead of the twelve months and the curve goes flat. Leave blank to use the monthly curve.', 'currency'],
  ['in_occupancy_adjustment', 'input', 'revenue', 'detail', 'Occupancy adjustment (all months)', 'Scales every month of the occupancy curve. +5% turns 70% into 73.5%.', 'percent'],
  ['in_adr_adjustment', 'input', 'revenue', 'detail', 'ADR adjustment (all months)', 'Scales every month of the ADR curve.', 'percent'],
  ['in_adr_growth', 'input', 'revenue', 'standard', 'ADR growth per year', '', 'percent'],
  ['in_occupancy_growth', 'input', 'revenue', 'standard', 'Occupancy growth per year', '', 'percent'],
  ['in_busy_nights_pct', 'input', 'revenue', 'detail', 'Busy nights (% of each month)', 'Fri + Sat = 2 of 7 = 29%. Offline keys only cost rooms on nights the hotel would have filled.', 'percent', '', '', 'calculated'],
  ['in_busy_night_lift', 'input', 'revenue', 'detail', 'Busy-night occupancy lift (points)', 'How far above the month\'s occupancy busy nights run (capped at 100%).', 'percent'],
  // ramp
  ['in_ramp_start_date', 'input', 'ramp', 'standard', 'When does the ramp start?', 'Takeover date, or the re-opening date after a shutdown.', 'month'],
  ['in_ramp_months', 'input', 'ramp', 'quick', 'How many months to reach stabilized? (max 36)', '0 for an asset that\'s already stabilized.', 'integer'],
  ['in_ramp_rate_share', 'input', 'ramp', 'standard', 'How much of the ramp is rate (vs occupancy)?', '0% = hold rate and fill rooms; 100% = rooms stay full and rate climbs.', 'percent'],
  ['in_preramp_occupancy', 'input', 'ramp', 'detail', 'Pre-ramp occupancy (% of stabilized)', 'Only used when the ramp starts after the model start.', 'percent'],
  ['in_preramp_adr', 'input', 'ramp', 'detail', 'Pre-ramp ADR (% of stabilized)', 'Only used when the ramp starts after the model start.', 'percent'],
  ['in_ramp_revpar_pct', 'list', 'ramp', 'detail', 'Ramp curve: RevPAR as % of stabilized, by month', '', 'percent', RAMP],
  // capital
  ['in_renovation_phases', 'grid', 'capital', 'standard', 'Renovation / shutdown phases', 'Rooms taken offline. Leave blank if none.', 'grid', 'D:Phase name:text|E:Keys offline:integer|F:Start month:month|G:Months offline:integer'],
  ['in_dev_line_items', 'grid', 'capital', 'standard', 'Capital budget line items', 'One row per item; HeyPhil fills subtotal, contingency and cost per key from the sheet.', 'grid', `C:Category:choice:${DEV_CATS}|D:Line item:text|E:Qty:number|F:Unit:text|G:Cost per unit:currency|I:Contingency %:percent|M:Guest impact:text|N:Hard or soft:choice:Hard|Soft`],
  ['in_dev_contingency_pct', 'input', 'capital', 'standard', 'Global contingency on hard costs', '', 'percent'],
  ['in_ffe_reserve_pct', 'input', 'capital', 'standard', 'FF&E reserve (% of revenue)', '', 'percent'],
  ['in_ffe_reserve_start_date', 'input', 'capital', 'standard', 'FF&E reserve starts', '', 'month'],
  // new keys
  ['in_keys_added', 'input', 'newkeys', 'standard', 'Keys added (negative to remove)', '', 'integer'],
  ['in_new_keys_open_date', 'input', 'newkeys', 'standard', 'Opening month for the added keys', 'First night the added keys are for sale.', 'month', '', 'in_keys_added!=0'],
  ['in_new_keys_ramp_months', 'input', 'newkeys', 'detail', 'Months for the added keys to ramp (max 12)', '', 'integer', '', 'in_keys_added!=0'],
  ['in_new_keys_ramp_occupancy', 'list', 'newkeys', 'detail', 'Added keys: occupancy ramp (% of stabilized)', '', 'percent', NEWKEY_RAMP, 'in_keys_added!=0'],
  ['in_new_keys_ramp_adr', 'list', 'newkeys', 'detail', 'Added keys: ADR ramp (% of stabilized)', '', 'percent', NEWKEY_RAMP, 'in_keys_added!=0'],
  // other revenue
  ['in_fb_per_occupied_room', 'input', 'other_revenue', 'standard', 'F&B spend per occupied room', '', 'currency'],
  ['in_fb_capture_rate', 'input', 'other_revenue', 'standard', 'F&B capture rate (% of guests)', '', 'percent'],
  ['in_other_dept_per_occupied_room', 'input', 'other_revenue', 'standard', 'Other operated departments, $ per occupied room', '', 'currency'],
  ['in_misc_income_per_occupied_room', 'input', 'other_revenue', 'standard', 'Miscellaneous income, $ per occupied room', '', 'currency'],
  ['in_lease_income', 'input', 'other_revenue', 'standard', 'Lease / rent income ($ per year)', 'A leased restaurant or retail space. Grows at the ancillary growth rate.', 'currency'],
  ['in_ancillary_growth', 'input', 'other_revenue', 'detail', 'Ancillary revenue growth per year', '', 'percent'],
  // opex
  ['in_opex_builder', 'grid', 'opex', 'standard', 'Operating expenses by USALI category', 'How each category is costed. "Detail Build-up" uses the line items and payroll below.', 'grid', `C:Category:label:${OPEX_CATS}|D:Costing method:choice:${OPEX_METHODS}|E:Value:number|F:Fixed %:percent|G:Variable driver:choice:${DRIVERS}`, '', 'some cells calculated'],
  ['in_expense_growth', 'input', 'opex', 'standard', 'Expense growth per year', 'Applied to every expense line.', 'percent'],
  ['in_fixed_costs_kept_closed', 'input', 'opex', 'detail', 'Fixed costs kept while closed', 'Share of fixed costs that continue while rooms are offline.', 'percent'],
  ['in_franchise_fee_by_year', 'list', 'opex', 'detail', 'Franchise fee by year (% of rooms revenue)', 'Blank = use the builder rate.', 'percent', YEARS8],
  ['in_opex_line_items', 'grid', 'opex', 'detail', 'Expense line items', 'Recurring stabilized-year items for categories set to Detail Build-up.', 'grid', `C:Category:choice:${OPEX_CATS}|D:Line item:text|E:Qty:number|F:Unit cost:currency|G:Frequency:choice:Monthly|Annual|H:Notes:text`],
  ['in_payroll_items', 'grid', 'opex', 'detail', 'Payroll', 'Positions for categories set to Detail Build-up.', 'grid', `C:Category:choice:${OPEX_CATS}|D:Position:text|E:FTE:number|F:Annual wage:currency|G:Burden %:percent|H:Notes:text`],
  ['in_days_in_year', 'input', 'opex', 'detail', 'Days in the year', '', 'integer'],
  // debt
  ['in_loan_sizing_method', 'input', 'debt', 'quick', 'How should the loan be sized?', '', 'choice', 'Loan Amount (manual)|Target Loan-to-Cost|Target Minimum DSCR'],
  ['in_loan_amount_manual', 'input', 'debt', 'quick', 'Loan amount', '', 'currency', '', 'in_loan_sizing_method=Loan Amount (manual)'],
  ['in_target_ltc', 'input', 'debt', 'quick', 'Target loan-to-cost', '', 'percent', '', 'in_loan_sizing_method=Target Loan-to-Cost'],
  ['in_target_dscr', 'input', 'debt', 'quick', 'Target minimum DSCR', '', 'multiple', '', 'in_loan_sizing_method=Target Minimum DSCR'],
  ['in_dscr_sizing_year', 'input', 'debt', 'detail', 'DSCR sizing year (0 = weakest year)', 'Leave at 0 to size off the weakest full year.', 'integer', '', 'in_loan_sizing_method=Target Minimum DSCR'],
  ['in_interest_rate', 'input', 'debt', 'quick', 'Interest rate', '', 'percent'],
  ['in_io_months', 'input', 'debt', 'standard', 'Interest-only period (months)', '', 'integer'],
  ['in_amortization_years', 'input', 'debt', 'standard', 'Amortization (years)', '', 'integer'],
  ['in_loan_term_years', 'input', 'debt', 'standard', 'Loan term (years to maturity)', 'Amortization sets the payment; the term sets the balloon.', 'integer'],
  ['in_origination_fee', 'input', 'debt', 'standard', 'Origination fee (% of loan)', '', 'percent'],
  ['in_guarantee_fee', 'input', 'debt', 'detail', 'Guarantee fee (% per year)', '', 'percent'],
  ['in_prepayment_fee', 'input', 'debt', 'detail', 'Prepayment fee (% of payoff)', '', 'percent'],
  // equity
  ['in_outside_lp_equity', 'input', 'equity', 'standard', 'Outside LP equity', '', 'currency'],
  ['in_philo_lp_equity', 'input', 'equity', 'standard', 'Philo LP equity', '', 'currency'],
  ['in_spv_expenses', 'input', 'equity', 'detail', 'SPV / partnership expenses ($ per year)', 'Entity-level costs borne by the LP class (K-1s, audit, admin).', 'currency'],
  ['in_wf_pref_rate', 'input', 'equity', 'standard', 'Preferred return', '', 'percent'],
  ['in_wf_tier1_lp_share', 'input', 'equity', 'detail', 'Tier 1 LP share', '', 'percent'],
  ['in_wf_catchup1_to', 'input', 'equity', 'detail', 'GP catch-up to', '', 'percent'],
  ['in_wf_hurdle2_rate', 'input', 'equity', 'detail', 'Second hurdle (IRR)', '', 'percent'],
  ['in_wf_tier3_lp_share', 'input', 'equity', 'detail', 'Tier 3 LP share', '', 'percent'],
  ['in_wf_catchup2_to', 'input', 'equity', 'detail', 'Second GP catch-up to', '', 'percent'],
  ['in_wf_residual_lp_share', 'input', 'equity', 'detail', 'Residual LP share', '', 'percent'],
  // exit
  ['in_exit_year', 'input', 'exit', 'quick', 'Exit year', '', 'integer'],
  ['in_exit_cap_rate', 'input', 'exit', 'quick', 'Exit cap rate', '', 'percent'],
  ['in_cost_of_sale', 'input', 'exit', 'standard', 'Cost of sale', '', 'percent'],
  // tax
  ['in_tax_depreciation_method', 'input', 'tax', 'detail', 'Depreciation method', '', 'choice', 'Bonus + MACRS|MACRS only|Straight line'],
  ['in_tax_land_pct', 'input', 'tax', 'detail', 'Land (% of basis)', '', 'percent'],
  ['in_tax_5yr_pct', 'input', 'tax', 'detail', '5-year property (% of basis)', '', 'percent'],
  ['in_tax_15yr_pct', 'input', 'tax', 'detail', '15-year property (% of basis)', '', 'percent'],
  ['in_tax_bonus_rate', 'input', 'tax', 'detail', 'Bonus depreciation rate', '', 'percent', '', 'in_tax_depreciation_method=Bonus + MACRS'],
  ['in_tax_ordinary_rate', 'input', 'tax', 'detail', 'Ordinary income tax rate', '', 'percent'],
  ['in_tax_capital_gains_rate', 'input', 'tax', 'detail', 'Capital gains rate', '', 'percent'],
  ['in_tax_recapture_rate', 'input', 'tax', 'detail', 'Depreciation recapture rate', '', 'percent'],
  ['in_tax_lp_share', 'input', 'tax', 'detail', 'LP share of taxable income', '', 'percent'],
];

// [named range, group, level, label, type]
const OUTPUTS = [
  ['out_project_irr', 'Returns', 'headline', 'Project IRR', 'percent'],
  ['out_lp_irr', 'Returns', 'headline', 'LP IRR', 'percent'],
  ['out_lp_equity_multiple', 'Returns', 'headline', 'LP equity multiple', 'multiple'],
  ['out_equity_multiple', 'Returns', 'detail', 'Equity multiple (all equity)', 'multiple'],
  ['out_lp_irr_after_tax', 'Returns', 'detail', 'LP IRR after tax', 'percent'],
  ['out_lp_irr_tax_advantaged', 'Returns', 'detail', 'LP IRR, tax-advantaged', 'percent'],
  ['out_lp_profit', 'Returns', 'detail', 'LP profit', 'currency'],
  ['out_lp_distributions', 'Returns', 'detail', 'LP distributions', 'currency'],
  ['out_profit_to_equity', 'Returns', 'detail', 'Profit to equity', 'currency'],
  ['out_total_distributions', 'Returns', 'detail', 'Total distributions', 'currency'],
  ['out_gp_promote', 'Returns', 'detail', 'GP promote', 'currency'],
  ['out_philo_total_economics', 'Returns', 'detail', 'Philo total economics', 'currency'],
  ['out_total_uses', 'Capital', 'headline', 'Total uses', 'currency'],
  ['out_total_uses_per_key', 'Capital', 'headline', 'Total uses per key', 'currency'],
  ['out_cash_equity_at_close', 'Capital', 'headline', 'Cash equity at close', 'currency'],
  ['out_capex_funded_at_close', 'Capital', 'detail', 'Capex funded at close', 'currency'],
  ['out_key_money', 'Capital', 'detail', 'Key money', 'currency'],
  ['out_equity_needed', 'Capital', 'detail', 'Equity needed', 'currency'],
  ['out_total_equity', 'Capital', 'detail', 'Total equity', 'currency'],
  ['out_equity_contributed', 'Capital', 'detail', 'Equity contributed', 'currency'],
  ['out_equity_surplus', 'Capital', 'detail', 'Equity surplus / (shortfall)', 'currency'],
  ['out_total_keys', 'Operations', 'detail', 'Total keys', 'integer'],
  ['out_adjusted_occupancy', 'Operations', 'headline', 'Stabilized occupancy', 'percent'],
  ['out_adjusted_adr', 'Operations', 'headline', 'Stabilized ADR', 'currency'],
  ['out_stab_occupancy', 'Operations', 'detail', 'Seasonal curve occupancy (before adjustment)', 'percent'],
  ['out_stab_adr', 'Operations', 'detail', 'Seasonal curve ADR (before adjustment)', 'currency'],
  ['out_stab_revpar', 'Operations', 'detail', 'Stabilized RevPAR', 'currency'],
  ['out_stab_rooms_revenue', 'Operations', 'detail', 'Stabilized rooms revenue', 'currency'],
  ['out_year1_revenue', 'Operations', 'detail', 'Year 1 revenue', 'currency'],
  ['out_year1_ebitda', 'Operations', 'detail', 'Year 1 EBITDA', 'currency'],
  ['out_year1_margin', 'Operations', 'detail', 'Year 1 EBITDA margin', 'percent'],
  ['out_stabilized_ebitda', 'Operations', 'headline', 'Stabilized EBITDA', 'currency'],
  ['out_going_in_cap_rate', 'Operations', 'detail', 'Going-in cap rate', 'percent'],
  ['out_loan_amount', 'Debt', 'headline', 'Loan amount', 'currency'],
  ['out_loan_to_cost', 'Debt', 'headline', 'Loan-to-cost', 'percent'],
  ['out_annual_debt_service', 'Debt', 'detail', 'Annual debt service', 'currency'],
  ['out_min_dscr', 'Debt', 'headline', 'Minimum DSCR', 'multiple'],
  ['out_peak_ltv', 'Debt', 'detail', 'Peak LTV', 'percent'],
  ['out_min_debt_yield', 'Debt', 'detail', 'Minimum debt yield', 'percent'],
  ['out_gross_exit_value', 'Exit', 'headline', 'Gross exit value', 'currency'],
  ['out_exit_value_per_key', 'Exit', 'detail', 'Exit value per key', 'currency'],
  ['out_exit_noi', 'Exit', 'detail', 'Exit NOI', 'currency'],
  ['out_exit_ebitda_multiple', 'Exit', 'detail', 'Exit EBITDA multiple', 'multiple'],
  ['out_exit_date', 'Exit', 'detail', 'Exit date', 'text'],
  ['out_waterfall_check', 'Checks', 'detail', 'Waterfall check (should be 0)', 'currency'],
  ['out_min_cash', 'Checks', 'detail', 'Minimum cash balance reached', 'currency'],
];

// Named ranges v1.3 adds (0-based rows/cols, end exclusive).
const col = (L) => L.charCodeAt(0) - 65;
const NEW_NAMES = [
  ['in_renovation_phases', 'Financial Model', 24, 29, 'D', 'G'],
  ['in_flat_occupancy', 'Financial Model', 48, 48, 'E', 'E'],
  ['in_flat_adr', 'Financial Model', 48, 48, 'F', 'F'],
  ['out_adjusted_adr', 'Financial Model', 50, 50, 'H', 'H'],
  ['out_adjusted_occupancy', 'Financial Model', 51, 51, 'H', 'H'],
  ['in_days_in_year', 'Operations', 8, 8, 'E', 'E'],
  ['in_opex_builder', 'Operations', 27, 40, 'C', 'G'],
  ['in_expense_growth', 'Operations', 45, 45, 'E', 'E'],
  ['in_fixed_costs_kept_closed', 'Operations', 46, 46, 'E', 'E'],
  ['in_franchise_fee_by_year', 'Operations', 49, 49, 'E', 'L'],
  ['in_opex_line_items', 'Operations', 54, 83, 'C', 'H'],
  ['in_payroll_items', 'Operations', 88, 102, 'C', 'H'],
  ['in_dev_contingency_pct', 'Development', 11, 11, 'E', 'E'],
  ['in_dev_line_items', 'Development', 24, 83, 'C', 'N'],
].map(([name, sheet, r1, r2, c1, c2]) => ({ name, sheet, startRow: r1 - 1, endRow: r2, startCol: col(c1), endCol: col(c2) + 1 }));

export function buildRows() {
  const header = ['Key', 'Kind', 'Target', 'Step', 'Level', 'Order', 'Question', 'Help', 'Type', 'Options', 'Show if', 'Notes'];
  const rows = [header];
  STEPS.forEach(([key, title, intro], i) => rows.push([key, 'step', '', key, '', String((i + 1) * 100), title, intro, '', '', '', '']));
  const order = {};
  INPUTS.forEach(([key, kind, step, level, q, help, type, options = '', showIf = '', notes = '']) => {
    order[step] = (order[step] || 0) + 10;
    const target = kind === 'target' ? (notes.match(/writes (\S+)/) || [])[1] : key;
    rows.push([key, kind, target, step, level, String(order[step]), q, help, type, options, showIf, notes]);
  });
  const groupOrder = {};
  OUTPUTS.forEach(([name, group, level, label, type]) => {
    groupOrder[group] = (groupOrder[group] || 0) + 10;
    rows.push([name, 'output', name, group, level, String(groupOrder[group]), label, '', type, '', '', '']);
  });
  return rows;
}

async function main() {
  const [id, flag] = process.argv.slice(2);
  if (!id) { console.error('usage: hospitality-map.mjs <spreadsheetId> [--write]'); process.exit(1); }
  const rows = buildRows();
  // the guard checks the file is inside HeyPhil and was made by HeyPhil
  const meta = await g.getFile(id);
  console.log(`File: ${meta.name}`);
  console.log(`Map: ${rows.length - 1} rows (${STEPS.length} steps, ${INPUTS.length} inputs, ${OUTPUTS.length} outputs); new names: ${NEW_NAMES.map((n) => n.name).join(', ')}`);
  if (flag !== '--write') { console.log('Dry run - add --write to write it.'); return; }
  const r = await g.addTemplateStructure(id, { ensureSheets: ['HeyPhil Map'], named: NEW_NAMES, ensureSize: { 'HeyPhil Map': { rows: rows.length + 20, cols: 12 } } });
  console.log('Structure:', JSON.stringify(r));
  // text is written so nothing can turn into a formula
  await g.writeCells(id, { updates: [{ range: `'HeyPhil Map'!A1:L${rows.length}`, values: rows.map((r) => r.map(sheetSafe)) }] });
  console.log(`Wrote ${rows.length} rows to 'HeyPhil Map'.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
