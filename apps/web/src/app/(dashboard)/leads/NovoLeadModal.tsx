'use client';

/**
 * Cadastro de lead pelo vendedor.
 *
 * Quem liga, manda mensagem ou entra na loja não passa pelo formulário do
 * site — e até aqui não existia como registrar essas pessoas. O resultado é o
 * que o levantamento de CRMs chamou de "funil que vaza": o atendimento
 * acontece e o sistema não sabe.
 *
 * O cadastro passa pela mesma deduplicação da rota pública: é comum a pessoa
 * preencher o formulário e ligar dez minutos depois, e o vendedor não tem como
 * saber disso antes de cadastrar. Quando cai num lead que já existia, a tela
 * diz — senão o vendedor cadastraria de novo achando que não salvou.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2, UserPlus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { textoDoErro } from '@/components/ErroAoCarregar';
import { LEAD_SOURCES_MANUAIS, ROTULO_DA_ORIGEM_DE_LEAD } from '@autoconnect/shared';



interface Membro { id: string; fullName: string; role: string }
interface VeiculoDaLoja {
  id: string;
  versionName: string | null;
  yearModel: number;
  brand: { name: string };
  model: { name: string };
}

export default function NovoLeadModal({
  onClose, onCriado,
}: {
  onClose: () => void;
  /** Recebe `true` quando o contato caiu num lead que já existia. */
  onCriado: (deduplicado: boolean) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [origem, setOrigem] = useState<(typeof LEAD_SOURCES_MANUAIS)[number]>('phone');
  const [vehicleId, setVehicleId] = useState('');
  // Vazio = deixa o backend decidir: o vendedor fica com o próprio lead, e o
  // gerente manda para o rodízio. Preencher com o id de quem abriu o modal
  // faria o gerente virar responsável por todo lead que cadastrasse.
  const [assignedTo, setAssignedTo] = useState('');
  const [mensagem, setMensagem] = useState('');

  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoDaLoja[]>([]);
  // As duas listas são conveniência: sem elas dá para cadastrar do mesmo jeito,
  // então a falha vira aviso no campo, não bloqueio da tela. **Um aviso por
  // lista**: juntas num `Promise.all`, o 403 de `/users` descartava o estoque
  // que tinha voltado 200, e o vendedor ficava com "Nenhum" como única opção de
  // veículo — que é como o lead de balcão nascia sem carro e morria no card.
  const [erroDaEquipe, setErroDaEquipe] = useState('');
  const [erroDoEstoque, setErroDoEstoque] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [errosDeCampo, setErrosDeCampo] = useState<Record<string, string>>({});

  // `GET /users` é de gerente para cima. Pedir a lista como vendedor é pedir um
  // 403 conhecido de antemão — e o vendedor não escolhe responsável de
  // qualquer forma: o lead dele fica com ele.
  const podeEscolherResponsavel =
    user?.role === 'manager' || user?.role === 'tenant_admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!token) return;
    let vivo = true;

    if (podeEscolherResponsavel) {
      api<Membro[]>('/users', { token })
        .then((m) => { if (vivo) { setEquipe(m.filter((x) => x.role !== 'customer')); setErroDaEquipe(''); } })
        .catch((e) => { if (vivo) setErroDaEquipe(textoDoErro(e)); });
    }

    api<{ items: VeiculoDaLoja[] }>('/vehicles?status=available&perPage=100', { token })
      .then((v) => { if (vivo) { setVeiculos(v.items ?? []); setErroDoEstoque(''); } })
      .catch((e) => { if (vivo) setErroDoEstoque(textoDoErro(e)); });

    return () => { vivo = false; };
  }, [token, podeEscolherResponsavel]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSalvando(true);
    setErro('');
    setErrosDeCampo({});

    try {
      const criado = await api<{ deduplicado: boolean }>('/leads/manual', {
        method: 'POST',
        token,
        body: {
          contactName: nome.trim(),
          contactPhone: telefone.trim(),
          contactEmail: email.trim() || undefined,
          source: origem,
          vehicleId: vehicleId || undefined,
          assignedTo: assignedTo || undefined,
          message: mensagem.trim() || undefined,
        },
      });
      onCriado(criado.deduplicado);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length > 0) {
        setErrosDeCampo(Object.fromEntries(err.fieldErrors.map((f) => [f.field, f.message])));
        setErro('Confira os campos destacados.');
      } else {
        setErro(textoDoErro(err));
      }
    } finally {
      setSalvando(false);
    }
  }

  const campo = 'w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-slate-900 outline-none focus:ring-2 focus:ring-blue-500/30 transition';
  const borda = (e?: string) => (e ? 'border-rose-500' : 'border-slate-200 dark:border-slate-700');

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[2000] bg-black/50 backdrop-blur-sm" />
      <div className="fixed inset-0 z-[2001] flex items-start justify-center overflow-y-auto p-4 py-6">
        <form
          onSubmit={salvar}
          className="w-full max-w-md my-auto rounded-2xl bg-white dark:bg-slate-900
                     border border-slate-200 dark:border-slate-800 shadow-2xl"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <UserPlus size={15} className="text-blue-500" /> Novo lead
            </h2>
            <button type="button" onClick={onClose} aria-label="Fechar"
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-3.5">
            <div>
              <label htmlFor="nl-nome" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Nome</label>
              <input id="nl-nome" value={nome} onChange={(e) => setNome(e.target.value)} required
                className={`${campo} ${borda(errosDeCampo.contactName)}`} />
              {errosDeCampo.contactName && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.contactName}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="nl-tel" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Telefone</label>
                <input id="nl-tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} required
                  inputMode="tel" placeholder="(11) 98765-4321"
                  className={`${campo} ${borda(errosDeCampo.contactPhone)}`} />
                {errosDeCampo.contactPhone && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.contactPhone}</p>}
              </div>
              <div>
                <label htmlFor="nl-email" className="text-[11px] font-semibold text-slate-500 block mb-1.5">E-mail (opcional)</label>
                <input id="nl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className={`${campo} ${borda(errosDeCampo.contactEmail)}`} />
                {errosDeCampo.contactEmail && <p className="text-[11px] text-rose-500 mt-1">{errosDeCampo.contactEmail}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="nl-origem" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Como chegou</label>
                <select id="nl-origem" value={origem}
                  onChange={(e) => setOrigem(e.target.value as typeof origem)}
                  className={`${campo} ${borda()}`}>
                  {LEAD_SOURCES_MANUAIS.map((s) => (
                    <option key={s} value={s}>{ROTULO_DA_ORIGEM_DE_LEAD[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="nl-vendedor" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Responsável</label>
                {podeEscolherResponsavel ? (
                  <>
                    <select id="nl-vendedor" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                      className={`${campo} ${borda()}`}>
                      <option value="">Rodízio (próximo de plantão)</option>
                      {equipe.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
                    </select>
                    {erroDaEquipe && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                        Equipe não carregou ({erroDaEquipe}). O lead vai para o rodízio.
                      </p>
                    )}
                  </>
                ) : (
                  <p id="nl-vendedor" className={`${campo} ${borda()} text-slate-500`}>Eu mesmo</p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="nl-veiculo" className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                Veículo de interesse (opcional)
              </label>
              <select id="nl-veiculo" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
                className={`${campo} ${borda()}`}>
                <option value="">Nenhum</option>
                {veiculos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.brand.name} {v.model.name} {v.versionName ?? ''} {v.yearModel}
                  </option>
                ))}
              </select>
              {erroDoEstoque && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  Estoque não carregou ({erroDoEstoque}). Dá para cadastrar agora e
                  vincular o veículo pelo card do lead depois.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="nl-obs" className="text-[11px] font-semibold text-slate-500 block mb-1.5">Observação</label>
              <textarea id="nl-obs" rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)}
                placeholder="O que o cliente procura, prazo, forma de pagamento…"
                className={`${campo} ${borda()} resize-none`} />
            </div>

            {erro && (
              <div role="alert" className="flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 rounded-lg px-3 py-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" /> {erro}
              </div>
            )}
          </div>

          <div className="flex gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {salvando ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              Cadastrar
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
