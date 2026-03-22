# Unit Economics: Teamind MVP

**Date**: 2026-03-22
**Status**: Analysis — pre-implementation baseline

## COGS per Customer

| Component | Cost | At 50 orgs | At 500 orgs |
|-----------|------|------------|-------------|
| Supabase Pro | $25/mo flat | $0.50/org | $0.15/org |
| Qdrant Cloud | $0→$35/mo | $0.70/org | $0.30/org |
| Edge Functions | Included | $0 | $0 |
| **Total COGS** | | **$1.20/org/mo** | **$0.45/org/mo** |

## Gross Margin

| Plan | Price | COGS | Gross Margin |
|------|-------|------|--------------|
| Team ($25) | $25 | $1.20 | **95.2%** |
| Business ($99) | $99 | $1.20 | **98.8%** |

## Key Metrics

| Metric | Teamind | Benchmark | Assessment |
|--------|---------|-----------|------------|
| Blended ARPU | $45/mo | — | 60% Team + 30% Business + 10% Enterprise |
| Monthly churn | 3% (assumed) | <5% | Mid-market dev tools |
| LTV | $1,424 | — | ARPU × GM × (1/churn) |
| CAC | $100 | — | PLG/open-source, low-touch |
| LTV:CAC | **14.2:1** | ≥3:1 | Excellent |
| CAC Payback | **2.3 months** | <12 months | Excellent |
| Gross Margin | **95%** | ≥75% | Excellent |

## Revenue Milestones

Freemium conversion: 3% (conservative for dev tools).

| Milestone | Paying orgs | Free orgs | MRR | ARR | Infra/mo |
|-----------|-------------|-----------|-----|-----|----------|
| First revenue | 5 | 167 | $225 | $2.7K | $25 |
| Covers infra | 10 | 333 | $450 | $5.4K | $25 |
| Ramen profitable | 30 | 1,000 | $1,350 | $16K | $30 |
| Seed-ready | 100 | 3,333 | $4,500 | $54K | $60 |
| Series A territory | 500 | 16,667 | $22,500 | $270K | $200 |

## Free Tier as Marketing Cost

Each free user costs ~$0.02/mo (shared infra).
At 3,333 free orgs = $67/mo — acceptable pipeline cost.

## Usage Overage Revenue

| Type | Rate | Avg/org/mo | Revenue |
|------|------|------------|---------|
| Extra decisions | $0.005/ea | 200 | $1.00 |
| Extra searches | $0.002/ea | 500 | $1.00 |
| **Total** | | | **~$2/org/mo** |

+4-8% to ARPU, scales with usage.

## Recommendations for Implementation

1. **Activation > conversion** — biggest risk is not unit economics
   but freemium→paid conversion. Focus: init <3min, first search
   moment, team onboarding friction.

2. **Annual prepay** — add 20% discount for yearly ($240/yr vs $300).
   Improves cash flow, reduces churn. Add to pricing page in Phase 2.

3. **Expansion revenue** — usage-based pricing (more devs, more
   decisions) enables NDR >100%. Track per-org usage from Day 1
   (rate_limits table already supports this).

4. **Track unit economics from launch** — instrument: COGS per org
   (Supabase + Qdrant usage), activation rate (init→first store),
   conversion rate (free→paid), churn (monthly org activity).
