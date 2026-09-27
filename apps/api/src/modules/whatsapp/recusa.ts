/**
 * O provedor recusou a mensagem (número inexistente, fora da janela, modelo
 * não aprovado, conta bloqueada, provedor fora do ar…). A mensagem já está
 * gravada: o serviço a marca como `falhou` com este motivo, em vez de ela
 * sumir da tela — ou pior, parecer entregue.
 */
export class RecusaDoWhatsApp extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'RecusaDoWhatsApp';
  }
}
