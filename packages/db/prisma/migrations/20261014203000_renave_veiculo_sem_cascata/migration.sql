-- O registro do RENAVE não some com o carro.
--
-- Pendência registrada em 14/10/2026 ("Excluir um veículo apaga os registros
-- RENAVE dele"): a FK era CASCADE para não mudar o `DELETE /vehicles/:id`, que
-- agora responde 409 ("arquive em vez de excluir") quando há registro. A FK
-- passa a NO ACTION — a rede no banco para o que passar ao lado do service.
-- NO ACTION, e não RESTRICT, porque a exclusão da loja inteira apaga veículos e
-- registros pela mesma cascata do `tenant_id`, e NO ACTION só confere no fim da
-- instrução.
ALTER TABLE "renave_registros" DROP CONSTRAINT "renave_registros_vehicle_id_fkey";

ALTER TABLE "renave_registros" ADD CONSTRAINT "renave_registros_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
