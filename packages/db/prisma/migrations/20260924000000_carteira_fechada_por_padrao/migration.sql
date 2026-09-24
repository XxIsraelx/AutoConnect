-- Carteira do vendedor fechada por padrão.
--
-- A migration da Onda 1 nasceu com `vendedor_ve_todos_os_leads = true` para não
-- mudar o que a loja já enxergava. A decisão de 23/09/2026 é o contrário: o
-- piloto começa com carteira fechada, cada vendedor com os próprios leads e a
-- fila. Ainda não há cliente pagante, então as lojas existentes acompanham o
-- padrão novo em vez de ficarem num estado que ninguém escolheu.

ALTER TABLE "tenant_crm_settings"
  ALTER COLUMN "vendedor_ve_todos_os_leads" SET DEFAULT false;

UPDATE "tenant_crm_settings" SET "vendedor_ve_todos_os_leads" = false;
