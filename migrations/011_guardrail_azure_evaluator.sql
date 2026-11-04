-- Up Migration: 011_guardrail_azure_evaluator

ALTER TABLE guardrail_rules DROP CONSTRAINT chk_guardrail_rule_config;
ALTER TABLE guardrail_rules
  ADD CONSTRAINT chk_guardrail_rule_config
    CHECK (
      (rule_type = 'deterministic' AND cardinality(terms) > 0
        AND evaluator_provider IS NULL AND evaluator_model IS NULL AND evaluator_prompt IS NULL)
      OR (rule_type = 'intelligent' AND cardinality(terms) = 0
        AND evaluator_provider IS NOT NULL AND evaluator_provider IN ('ollama', 'gemini', 'azure-openai')
        AND evaluator_model IS NOT NULL AND evaluator_prompt IS NOT NULL)
    );

-- Down Migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM guardrail_rules WHERE evaluator_provider = 'azure-openai') THEN
    RAISE EXCEPTION 'Remove guardrail rules using azure-openai before rolling back migration 011';
  END IF;
END
$$;
ALTER TABLE guardrail_rules DROP CONSTRAINT chk_guardrail_rule_config;
ALTER TABLE guardrail_rules
  ADD CONSTRAINT chk_guardrail_rule_config
    CHECK (
      (rule_type = 'deterministic' AND cardinality(terms) > 0
        AND evaluator_provider IS NULL AND evaluator_model IS NULL AND evaluator_prompt IS NULL)
      OR (rule_type = 'intelligent' AND cardinality(terms) = 0
        AND evaluator_provider IS NOT NULL AND evaluator_provider IN ('ollama', 'gemini')
        AND evaluator_model IS NOT NULL AND evaluator_prompt IS NOT NULL)
    );
