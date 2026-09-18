/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, ChangeEvent } from "react";
import { 
  ShoppingBag, 
  Menu, 
  Search,
  Star, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft,
  ChevronRight,
  Truck, 
  ShieldCheck, 
  ArrowRight,
  Droplets,
  Sparkles,
  Zap,
  Moon,
  Sun,
  Flame,
  Instagram,
  Facebook,
  Mail,
  CreditCard,
  Copy,
  Check,
  QrCode,
  MapPin,
  User,
  Phone,
  FileText,
  Clock,
} from "lucide-react";
import { motion } from "motion/react";
import { mergeUrlParamsFromLocation } from "./urlParams";

const onlyDigits = (value: string) => value.replace(/\D/g, "");
const centsFromBRL = (value: number) => Math.round(Number(value) * 100);

async function notifyUtmifyPaid(orderData: {
  transactionId: string;
  createdAt?: string;
  total: number;
  quantity?: number;
  customer: { name: string; email: string; phone: string; cpf: string };
  kit?: { id?: string; name?: string };
  trackingParameters?: Record<string, string | null>;
}) {
  try {
    await fetch("/api/utmify/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: orderData.transactionId,
        status: "paid",
        createdAt: orderData.createdAt,
        customer: {
          name: orderData.customer.name,
          email: orderData.customer.email,
          phone: onlyDigits(orderData.customer.phone),
          document: onlyDigits(orderData.customer.cpf),
        },
        products: [
          {
            id: orderData.kit?.id || "colageno-tri-plus",
            name: orderData.kit?.name || "Colágeno TRI PLUS Body Action",
            planId: null,
            planName: null,
            quantity: orderData.quantity || 1,
            priceInCents: centsFromBRL(orderData.total),
          },
        ],
        trackingParameters: orderData.trackingParameters || {},
        totalPriceInCents: centsFromBRL(orderData.total),
        gatewayFeeInCents: 0,
        userCommissionInCents: centsFromBRL(orderData.total),
      }),
      keepalive: true,
    });
  } catch {
    /* não bloqueia o redirect */
  }
}

const formatCep = (digits: string) => {
  const d = digits.slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
};

const formatCpf = (digits: string) => {
  const d = digits.slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
};

const formatPhoneBr = (digits: string) => {
  const d = digits.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length === 0) return `(${ddd}) `;
  if (d.length <= 6) return `(${ddd}) ${rest}`;
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
};

const inputMaskedClass =
  "w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] focus:ring-2 focus:ring-[#E84A9A]/15 transition-all text-sm tabular-nums tracking-wide text-[#3F1848] placeholder:text-[#C9A3BE]";

const ORDER_BUMPS = [
  {
    id: "tipo2",
    name: "Colágeno Tipo II + Ácido Hialurônico",
    price: 34.9,
    image: "/orderbump-tipo2.jpg",
    description:
      "Acrescente o Colágeno Tipo II Body Action e reforce articulações e cartilagens com 40 mg de colágeno tipo II e ácido hialurônico em cápsulas práticas para o dia a dia.",
  },
  {
    id: "gel",
    name: "Colágeno Verisol em Gel",
    price: 29.9,
    image: "/orderbump-gel.jpg",
    description:
      "Leve também os sachês de Colágeno Verisol em gel: praticidade para a bolsa, com ácido hialurônico, biotina e vitaminas para pele, cabelos e unhas.",
  },
] as const;

// --- Checkout Components ---

const CheckoutHeader = () => (
  <header className="bg-white py-4 border-b border-[#F7EAF4] sticky top-0 z-50">
    <div className="max-w-5xl mx-auto px-4 flex items-center justify-between">
      <div className="h-8 bg-[#6B2178] px-3 rounded-lg flex items-center">
        <img 
          src="/logo-bodyaction.png" 
          alt="Body Action" 
          className="h-full w-auto object-contain"
        />
      </div>
      <div className="flex items-center gap-2 text-[#3F1848] font-bold text-sm uppercase tracking-wider">
        <ShieldCheck size={18} className="text-[#E84A9A]" />
        Checkout Seguro
      </div>
    </div>
  </header>
);

const Checkout = ({ kit, onBack, onFinish }: { kit: any, onBack: () => void, onFinish: (data: any) => Promise<void> }) => {
  const [step, setStep] = useState(1);
  const [quantity, setQuantity] = useState(1);
  const [shipping, setShipping] = useState<'free' | 'sedex'>('free');
  const [cepLoading, setCepLoading] = useState(false);
  const [address, setAddress] = useState({
    cep: '',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    city: '',
    state: ''
  });
  const [customer, setCustomer] = useState({
    name: '',
    email: '',
    cpf: '',
    phone: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedBumps, setSelectedBumps] = useState<Record<string, boolean>>({});

  const toggleOrderBump = (id: string) => {
    setSelectedBumps((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCepChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const digits = onlyDigits(e.target.value).slice(0, 8);
    const formatted = formatCep(digits);
    setAddress((prev) => ({ ...prev, cep: formatted }));

    if (digits.length === 8) {
      setCepLoading(true);
      try {
        const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        const data = await response.json();
        if (!data.erro) {
          setAddress((prev) => ({
            ...prev,
            cep: formatted,
            street: data.logradouro,
            neighborhood: data.bairro,
            city: data.localidade,
            state: data.uf,
          }));
        }
      } catch (error) {
        console.error("Erro ao buscar CEP", error);
      } finally {
        setCepLoading(false);
      }
    }
  };

  const cepDigits = onlyDigits(address.cep);

  const subtotal = kit.price * quantity;
  const activeOrderBumps = ORDER_BUMPS.filter((bump) => selectedBumps[bump.id]);
  const orderBumpPrice = activeOrderBumps.reduce((sum, bump) => sum + bump.price, 0);
  const shippingPrice = shipping === 'sedex' ? 19.45 : 0;
  const total = subtotal + orderBumpPrice + shippingPrice;
  
  const handleSubmitOrder = async () => {
    setSubmitError(null);
    const requiredFieldsFilled =
      customer.name.trim() &&
      customer.email.trim() &&
      customer.cpf.trim() &&
      customer.phone.trim();

    if (!requiredFieldsFilled) {
      setSubmitError("Preencha nome, e-mail, CPF e telefone para continuar.");
      return;
    }

    setSubmitting(true);
    try {
      await onFinish({
        total,
        customer,
        address,
        shipping,
        quantity,
        orderBumps: activeOrderBumps,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Não foi possível gerar o PIX.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDF7FB] pb-20">
      <CheckoutHeader />
      
      <main className="max-w-5xl mx-auto px-4 py-8">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-[#9B7594] text-sm mb-8 hover:text-[#E84A9A] transition-colors"
        >
          <ChevronLeft size={16} />
          Voltar para a loja
        </button>

        <div className="grid lg:grid-cols-[1fr_380px] gap-8 items-start">
          {/* Form Section */}
          <div className="space-y-6">
            {/* Dados Pessoais */}
            <section className="bg-white p-6 sm:p-8 rounded-3xl border border-[#F7EAF4] shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-[#F7EAF4] pb-4">
                <div className="w-10 h-10 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[#E84A9A]">
                  <User size={20} />
                </div>
                <h2 className="text-lg font-bold text-[#3F1848]">Dados Pessoais</h2>
              </div>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Nome Completo</label>
                  <input 
                    type="text" 
                    placeholder="Seu nome completo"
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={customer.name}
                    onChange={e => setCustomer({...customer, name: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">E-mail</label>
                  <input 
                    type="email" 
                    placeholder="seu@email.com"
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={customer.email}
                    onChange={e => setCustomer({...customer, email: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">CPF</label>
                  <input 
                    type="text" 
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    className={inputMaskedClass}
                    value={customer.cpf}
                    onChange={(e) =>
                      setCustomer({
                        ...customer,
                        cpf: formatCpf(onlyDigits(e.target.value)),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Celular / WhatsApp</label>
                  <input 
                    type="tel" 
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="(00) 00000-0000"
                    maxLength={15}
                    className={inputMaskedClass}
                    value={customer.phone}
                    onChange={(e) =>
                      setCustomer({
                        ...customer,
                        phone: formatPhoneBr(onlyDigits(e.target.value)),
                      })
                    }
                  />
                </div>
              </div>
            </section>

            {/* Entrega */}
            <section className="bg-white p-6 sm:p-8 rounded-3xl border border-[#F7EAF4] shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-[#F7EAF4] pb-4">
                <div className="w-10 h-10 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[#E84A9A]">
                  <MapPin size={20} />
                </div>
                <h2 className="text-lg font-bold text-[#3F1848]">Dados de Entrega</h2>
              </div>
              
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">CEP</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="00000-000"
                      maxLength={9}
                      className={inputMaskedClass}
                      value={address.cep}
                      onChange={handleCepChange}
                    />
                    {cepLoading && <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#E84A9A] border-t-transparent rounded-full animate-spin"></div>}
                  </div>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Endereço</label>
                  <input 
                    type="text" 
                    placeholder="Rua, Avenida..."
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={address.street}
                    onChange={e => setAddress({...address, street: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Número</label>
                  <input 
                    type="text" 
                    placeholder="123"
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={address.number}
                    onChange={e => setAddress({...address, number: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Complemento</label>
                  <input 
                    type="text" 
                    placeholder="Apto, Bloco..."
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={address.complement}
                    onChange={e => setAddress({...address, complement: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Bairro</label>
                  <input 
                    type="text" 
                    placeholder="Bairro"
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={address.neighborhood}
                    onChange={e => setAddress({...address, neighborhood: e.target.value})}
                  />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Cidade</label>
                  <input 
                    type="text" 
                    placeholder="Cidade"
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={address.city}
                    onChange={e => setAddress({...address, city: e.target.value})}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Estado</label>
                  <input 
                    type="text" 
                    placeholder="UF"
                    className="w-full px-4 py-3 rounded-xl border border-[#F7EAF4] bg-[#FDF7FB] focus:outline-none focus:border-[#E84A9A] transition-colors text-sm"
                    value={address.state}
                    onChange={e => setAddress({...address, state: e.target.value})}
                  />
                </div>
              </div>

              {cepDigits.length === 8 && (
                <div className="space-y-4 pt-4 border-t border-[#F7EAF4]">
                  <label className="text-xs font-bold text-[#3F1848] uppercase tracking-wider">Escolha o Frete</label>
                  <div className="grid gap-3">
                    <button 
                      onClick={() => setShipping('free')}
                      className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left ${shipping === 'free' ? 'border-[#E84A9A] bg-[#F7EAF4]' : 'border-[#F7EAF4] hover:border-[#E8C5DB]'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${shipping === 'free' ? 'border-[#E84A9A]' : 'border-[#9B7594]'}`}>
                          {shipping === 'free' && <div className="w-2.5 h-2.5 bg-[#E84A9A] rounded-full" />}
                        </div>
                        <div>
                          <p className="font-bold text-[#3F1848] text-sm">Frete Grátis</p>
                          <p className="text-xs text-[#9B7594]">7 a 10 dias úteis</p>
                        </div>
                      </div>
                      <span className="font-bold text-[#E84A9A] text-sm">Grátis</span>
                    </button>
                    <button 
                      onClick={() => setShipping('sedex')}
                      className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all text-left ${shipping === 'sedex' ? 'border-[#E84A9A] bg-[#F7EAF4]' : 'border-[#F7EAF4] hover:border-[#E8C5DB]'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${shipping === 'sedex' ? 'border-[#E84A9A]' : 'border-[#9B7594]'}`}>
                          {shipping === 'sedex' && <div className="w-2.5 h-2.5 bg-[#E84A9A] rounded-full" />}
                        </div>
                        <div>
                          <p className="font-bold text-[#3F1848] text-sm">SEDEX Express</p>
                          <p className="text-xs text-[#9B7594]">2 a 3 dias úteis</p>
                        </div>
                      </div>
                      <span className="font-bold text-[#3F1848] text-sm">R$ 19,45</span>
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Order Bumps */}
            <section className="bg-white p-6 sm:p-8 rounded-3xl border-2 border-dashed border-[#E84A9A] shadow-sm space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 bg-[#E84A9A] text-white text-[10px] font-bold uppercase tracking-widest rounded-full">
                  Ofertas exclusivas
                </span>
              </div>
              <div className="space-y-3">
                {ORDER_BUMPS.map((bump) => {
                  const isSelected = !!selectedBumps[bump.id];
                  return (
                    <button
                      key={bump.id}
                      type="button"
                      onClick={() => toggleOrderBump(bump.id)}
                      className={`w-full text-left rounded-2xl border-2 p-4 transition-all ${
                        isSelected
                          ? "border-[#E84A9A] bg-[#F7EAF4]"
                          : "border-[#F7EAF4] hover:border-[#E84A9A]/40"
                      }`}
                    >
                      <div className="flex gap-4">
                        <div className="w-20 h-20 sm:w-24 sm:h-24 bg-[#F7EAF4] rounded-xl overflow-hidden flex-shrink-0">
                          <img
                            src={bump.image}
                            alt={bump.name}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="flex-1 space-y-2 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-bold text-[#3F1848] text-sm sm:text-base leading-tight">
                              {bump.name}
                            </h3>
                            <p className="font-black text-[#E84A9A] text-sm sm:text-base whitespace-nowrap">
                              R$ {bump.price.toFixed(2).replace(".", ",")}
                            </p>
                          </div>
                          <p className="text-xs sm:text-sm text-[#9B7594] leading-relaxed">
                            {bump.description}
                          </p>
                          <div className="flex items-center gap-2 pt-1">
                            <div
                              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                                isSelected
                                  ? "border-[#E84A9A] bg-[#E84A9A] text-white"
                                  : "border-[#E8C5DB] bg-white"
                              }`}
                            >
                              {isSelected && <Check size={14} strokeWidth={3} />}
                            </div>
                            <span className="text-xs sm:text-sm font-bold text-[#3F1848]">
                              Sim, quero adicionar esta oferta!
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Pagamento */}
            <section className="bg-white p-6 sm:p-8 rounded-3xl border border-[#F7EAF4] shadow-sm space-y-6">
              <div className="flex items-center gap-3 border-b border-[#F7EAF4] pb-4">
                <div className="w-10 h-10 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[#E84A9A]">
                  <Zap size={20} />
                </div>
                <h2 className="text-lg font-bold text-[#3F1848]">Pagamento</h2>
              </div>
              
              <div className="p-4 rounded-2xl border-2 border-[#E84A9A] bg-[#F7EAF4] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#E84A9A] shadow-sm">
                    <Zap size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="font-bold text-[#3F1848] text-sm">PIX</p>
                    <p className="text-xs text-[#9B7594]">Aprovação imediata</p>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-[#9B7594] text-center italic">
                O código PIX será gerado após a finalização do pedido.
              </p>
            </section>
          </div>

          {/* Summary Section */}
          <div className="lg:sticky lg:top-28 space-y-6">
            <section className="bg-white p-6 rounded-3xl border border-[#F7EAF4] shadow-lg space-y-6">
              <h2 className="text-lg font-bold text-[#3F1848] border-b border-[#F7EAF4] pb-4">Resumo do Pedido</h2>
              
              <div className="flex gap-4">
                <div className="w-20 h-20 bg-[#F7EAF4] rounded-xl overflow-hidden flex-shrink-0 border border-[#F7EAF4]">
                  <img src={kit.image} alt={kit.name} className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 space-y-1">
                  <h3 className="font-bold text-[#3F1848] text-sm leading-tight">{kit.name}</h3>
                  <p className="text-xs text-[#9B7594]">Colágeno TRI PLUS · Verisol · Tipos I, II e III · Manga com Maracujá</p>
                  
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center border border-[#F7EAF4] rounded-lg overflow-hidden">
                      <button 
                        onClick={() => setQuantity(Math.max(1, quantity - 1))}
                        className="px-2 py-1 hover:bg-[#F7EAF4] text-[#E84A9A] transition-colors"
                      >
                        <ChevronDown size={14} />
                      </button>
                      <span className="px-3 py-1 text-xs font-bold text-[#3F1848] border-x border-[#F7EAF4] min-w-[32px] text-center">
                        {quantity}
                      </span>
                      <button 
                        onClick={() => setQuantity(quantity + 1)}
                        className="px-2 py-1 hover:bg-[#F7EAF4] text-[#E84A9A] transition-colors"
                      >
                        <ChevronUp size={14} />
                      </button>
                    </div>
                    <p className="font-bold text-[#3F1848] text-sm">R$ {subtotal.toFixed(2).replace('.', ',')}</p>
                  </div>
                </div>
              </div>

              {activeOrderBumps.map((bump) => (
                <div key={bump.id} className="flex gap-4 pt-2 border-t border-[#F7EAF4]">
                  <div className="w-20 h-20 bg-[#F7EAF4] rounded-xl overflow-hidden flex-shrink-0 border border-[#F7EAF4]">
                    <img src={bump.image} alt={bump.name} className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <h3 className="font-bold text-[#3F1848] text-sm leading-tight">{bump.name}</h3>
                    <p className="text-xs text-[#9B7594]">Oferta adicional</p>
                    <p className="font-bold text-[#3F1848] text-sm pt-2">
                      R$ {bump.price.toFixed(2).replace(".", ",")}
                    </p>
                  </div>
                </div>
              ))}

              <div className="space-y-3 pt-4 border-t border-[#F7EAF4]">
                <div className="flex justify-between text-sm">
                  <span className="text-[#9B7594]">Subtotal</span>
                  <span className="text-[#3F1848] font-medium">R$ {(subtotal + orderBumpPrice).toFixed(2).replace('.', ',')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#9B7594]">Frete</span>
                  <span className="text-[#E84A9A] font-bold">{shippingPrice > 0 ? `R$ ${shippingPrice.toFixed(2).replace('.', ',')}` : 'GRÁTIS'}</span>
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-[#F7EAF4]">
                  <span className="font-bold text-[#3F1848]">Total</span>
                  <div className="text-right">
                    <p className="text-2xl font-black text-[#3F1848]">R$ {total.toFixed(2).replace('.', ',')}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSubmitOrder}
                disabled={submitting}
                className="w-full py-4 bg-[#E84A9A] text-white rounded-full font-bold hover:bg-[#6B2178] transition-all shadow-lg shadow-pink-100 flex items-center justify-center gap-2 group"
              >
                {submitting ? "GERANDO PIX..." : "FINALIZAR PEDIDO"}
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
              {submitError && (
                <p className="text-xs text-red-500 text-center">{submitError}</p>
              )}

              <div className="flex items-center justify-center gap-4 pt-4 opacity-50 grayscale">
                <div className="flex items-center gap-1 text-[10px] font-bold text-[#3F1848]">
                  <ShieldCheck size={12} />
                  COMPRA SEGURA
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
};

const POST_PIX_PAID_REDIRECT_DEFAULT = "/checkout/obrigado.html";
const POST_PIX_POLL_MS = 200;

const PixSuccess = ({ orderData, onReset }: { orderData: any; onReset: () => void }) => {
  const [copied, setCopied] = useState(false);
  const pixCode = orderData.pixCode as string;
  const qrCodeImage = orderData.qrCodeImage as string | undefined;
  const transactionId = typeof orderData.transactionId === "string" ? orderData.transactionId : "";
  const orderDataRef = useRef(orderData);
  orderDataRef.current = orderData;

  useEffect(() => {
    const redirectUrl =
      (import.meta.env.VITE_PIX_PAID_REDIRECT_URL as string | undefined)?.trim() ||
      POST_PIX_PAID_REDIRECT_DEFAULT;
    if (!transactionId) return;

    let cancelled = false;
    let inFlight = false;
    let paidNotified = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const started = Date.now();
    const maxMs = 2 * 60 * 60 * 1000;

    const stop = () => {
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (Date.now() - started > maxMs) {
        stop();
        return;
      }
      inFlight = true;
      try {
        const r = await fetch(`/api/pix/status?id=${encodeURIComponent(transactionId)}`);
        const j = await r.json();
        if (cancelled) return;
        const status = String(j?.transaction?.status || "").toUpperCase();
        if (status === "PAID") {
          stop();
          if (!paidNotified) {
            paidNotified = true;
            await notifyUtmifyPaid(orderDataRef.current);
          }
          if (!cancelled) window.location.replace(redirectUrl);
        }
      } catch {
        /* próximo ciclo */
      } finally {
        inFlight = false;
      }
    };

    intervalId = setInterval(tick, POST_PIX_POLL_MS);
    void tick();

    return () => {
      cancelled = true;
      stop();
    };
  }, [transactionId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(pixCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#FDF7FB] pb-20">
      <CheckoutHeader />

      <main className="max-w-2xl mx-auto px-4 py-12 text-center space-y-8">
        <div className="space-y-4">
          <div className="w-20 h-20 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[#E84A9A] mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#3F1848]">Pedido Realizado com Sucesso!</h1>
          <p className="text-[#9B7594] max-w-md mx-auto">
            Falta pouco! Realize o pagamento via PIX para que possamos enviar seu Colágeno TRI PLUS o quanto antes.
          </p>
          {transactionId ? (
            <p className="text-xs text-[#E84A9A] font-medium max-w-md mx-auto">
              Aguardando confirmação do pagamento… você será redirecionado assim que o PIX for aprovado.
            </p>
          ) : null}
        </div>

        <div className="bg-white p-8 rounded-3xl border border-[#F7EAF4] shadow-xl space-y-8">
          <div className="space-y-2">
            <p className="text-xs font-bold text-[#9B7594] uppercase tracking-widest">Valor a pagar</p>
            <p className="text-4xl font-black text-[#3F1848]">
              R$ {Number(orderData.total).toFixed(2).replace(".", ",")}
            </p>
          </div>

          <div className="bg-[#F7EAF4] p-6 rounded-2xl inline-block border-2 border-[#E8C5DB]">
            {qrCodeImage ? (
              <img
                src={qrCodeImage.startsWith("data:") ? qrCodeImage : `data:image/png;base64,${qrCodeImage}`}
                alt="QR Code PIX"
                className="w-[180px] h-[180px] object-contain"
              />
            ) : (
              <QrCode size={180} className="text-[#3F1848]" />
            )}
          </div>

          <div className="space-y-4">
            <p className="text-sm font-bold text-[#3F1848]">Código PIX Copia e Cola</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                readOnly
                value={pixCode}
                className="flex-1 bg-[#FDF7FB] border border-[#F7EAF4] rounded-xl px-4 py-3 text-xs text-[#9B7594] truncate"
              />
              <button
                onClick={handleCopy}
                className="w-full sm:w-auto bg-[#E84A9A] text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-[#6B2178] transition-all"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 text-left max-w-md mx-auto">
          <h3 className="font-bold text-[#3F1848] flex items-center gap-2">
            <Clock size={18} className="text-[#E84A9A]" />
            Como pagar?
          </h3>
          <ol className="space-y-3 text-sm text-[#9B7594]">
            <li className="flex gap-3">
              <span className="w-5 h-5 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[10px] font-bold text-[#E84A9A] flex-shrink-0">
                1
              </span>
              Abra o app do seu banco e escolha a opção PIX.
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[10px] font-bold text-[#E84A9A] flex-shrink-0">
                2
              </span>
              Escaneie o QR Code ou cole o código acima.
            </li>
            <li className="flex gap-3">
              <span className="w-5 h-5 bg-[#F7EAF4] rounded-full flex items-center justify-center text-[10px] font-bold text-[#E84A9A] flex-shrink-0">
                3
              </span>
              Confirme os dados e finalize o pagamento.
            </li>
          </ol>
        </div>

        <button
          onClick={onReset}
          className="text-[#9B7594] text-sm font-medium hover:text-[#E84A9A] transition-colors pt-8"
        >
          Voltar para a página inicial
        </button>
      </main>
    </div>
  );
};


const AnnouncementBar = () => (
  <div className="bg-[#F7EAF4] text-[#E84A9A] text-[10px] py-2 px-4 text-center font-medium tracking-wider uppercase border-b border-[#E8C5DB]">
    FRETE GRÁTIS PARA TODO O BRASIL
  </div>
);

const Header = ({ cartCount }: { cartCount: number }) => {
  return (
    <header className="bg-white py-3 sm:py-4 border-b border-[#F7EAF4] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
        <button className="text-[#9B7594] p-1">
          <Menu size={24} sm:size={28} strokeWidth={1.5} />
        </button>
        
        <div className="h-8 sm:h-10 bg-[#6B2178] px-3 rounded-lg flex items-center">
          <img 
            src="/logo-bodyaction.png" 
            alt="Body Action" 
            className="h-5 sm:h-7 w-auto object-contain"
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button className="text-[#9B7594] p-1">
            <Search size={20} sm:size={24} strokeWidth={1.5} />
          </button>
          <button className="relative text-[#9B7594] p-1">
            <ShoppingBag size={20} sm:size={24} strokeWidth={1.5} />
            {cartCount > 0 && (
              <span className="absolute top-0 right-0 bg-[#E84A9A] text-white text-[8px] w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full flex items-center justify-center font-bold">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};

const DarkHero = () => (
  <section className="bg-[#6B2178] text-white py-12 sm:py-16 px-4 sm:px-6 text-center space-y-6 sm:space-y-8">
    <div className="flex items-center justify-center gap-4 sm:gap-8 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest opacity-80 pb-4 border-b border-white/10">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse" />
        Peptídeos Verisol
      </div>
      <div className="flex items-center gap-2">
        <Sun size={12} sm:size={14} />
        Colágenos Tipo I, II e III
      </div>
    </div>

    <div className="relative max-w-4xl mx-auto rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl">
      <img 
        src="/tri-plus-dark-hero.png" 
        alt="Tratamento completo com Colágeno TRI PLUS — pele, cabelos, unhas e articulações" 
        className="w-full h-auto object-contain"
      />
    </div>

    <h2 className="text-3xl sm:text-4xl font-bold leading-tight">
      Beleza de dentro <br />
      para fora, todo dia.
    </h2>

    <p className="text-sm leading-relaxed text-[#F7EAF4] text-center max-w-md mx-auto px-2">
      O <strong>Colágeno TRI PLUS Body Action</strong> combina <strong>peptídeos Verisol</strong>, 
      <strong> colágeno tipo II</strong> e <strong>ácido hialurônico</strong> — uma fórmula com 
      biotina, coenzima Q10, silício, vitaminas e minerais para pele mais firme, cabelos e unhas 
      fortalecidos e articulações nutridas.
    </p>

    <div className="pt-2 sm:pt-4">
      <button 
        onClick={() => document.getElementById('kits')?.scrollIntoView({ behavior: 'smooth' })}
        className="w-full sm:w-auto bg-white text-[#3F1848] px-6 sm:px-10 py-4 sm:py-5 rounded-full font-bold text-xs sm:text-sm shadow-xl active:scale-95 transition-transform"
      >
        Quero pele, cabelos e articulações renovados!
      </button>
    </div>
  </section>
);

const SkinIssuesCarousel = () => {
  const issues = [
    { title: "Rugas e linhas finas", img: "/issue-pele.jpg" },
    { title: "Flacidez da pele", img: "https://i.ibb.co/yB6x2v8Q/image.png" },
    { title: "Cabelos frágeis", img: "/issue-cabelo.jpg" },
    { title: "Unhas quebradiças", img: "/issue-unhas.jpg" },
    { title: "Desconforto articular", img: "/issue-articulacoes.jpg" },
  ];

  // Double the array for infinite effect
  const doubledIssues = [...issues, ...issues];
  const itemWidth = 160;
  const gap = 16;
  const totalDistance = (itemWidth + gap) * issues.length;

  return (
    <section className="bg-[#6B2178] pb-12 overflow-hidden">
      <motion.div 
        className="flex gap-4 px-6"
        animate={{
          x: [0, -totalDistance],
        }}
        transition={{
          x: {
            repeat: Infinity,
            repeatType: "loop",
            duration: 20,
            ease: "linear",
          },
        }}
        style={{ width: "max-content" }}
      >
        {doubledIssues.map((issue, i) => (
          <div key={i} style={{ width: `${itemWidth}px` }} className="bg-white rounded-xl p-1.5 shadow-lg">
            <div className="aspect-square rounded-lg overflow-hidden mb-2">
              <img src={issue.img} alt={issue.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <p className="font-bold text-[#3F1848] text-[11px] leading-tight px-1 pb-1 text-center">{issue.title}</p>
          </div>
        ))}
      </motion.div>
    </section>
  );
};

const LandingHero = () => (
  <section className="relative min-h-[80vh] sm:min-h-[90vh] flex items-center pt-12 sm:pt-20 pb-20 sm:pb-32 overflow-hidden bg-white">
    {/* Decorative elements */}
    <div className="absolute top-0 right-0 w-1/2 h-full bg-[#F7EAF4] -z-10 rounded-l-[100px] hidden lg:block"></div>
    <div className="absolute top-20 right-20 w-64 h-64 bg-[#E84A9A]/10 rounded-full blur-3xl -z-10 animate-pulse"></div>
    
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="space-y-8 sm:space-y-12 text-center"
      >
        <div className="space-y-6 sm:space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#F7EAF4] rounded-full text-[10px] sm:text-xs font-bold text-[#E84A9A] uppercase tracking-widest mx-auto">
            <Sparkles size={14} /> Verisol · Colágeno TRI PLUS
          </div>
          
          <h1 className="text-3xl sm:text-4xl lg:text-6xl font-bold text-[#3F1848] leading-[1.1] tracking-tight">
            Pele, cabelos e unhas <br />
            <span className="text-[#E84A9A]">fortalecidos</span> <br className="hidden sm:block" />
            de dentro para fora.
          </h1>
        </div>

        {/* Image moved below title */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="relative max-w-4xl mx-auto px-4 sm:px-0"
        >
          <div className="relative z-10 rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_30px_60px_-15px_rgba(232,74,154,0.28)]">
            <img 
              src="/tri-plus-hero.png" 
              alt="Colágeno TRI PLUS Body Action — Verisol, Tipos I, II e III, Ácido Hialurônico" 
              className="w-full h-auto object-contain"
            />
          </div>
        </motion.div>
        
        <div className="space-y-8 sm:space-y-10">
          <p className="text-lg sm:text-xl text-[#9B7594] max-w-2xl leading-relaxed mx-auto">
            Colágeno Verisol com tipos I, II e III, ácido hialurônico, biotina e coenzima Q10. Favorece a firmeza da pele, fortalece cabelos e unhas e nutre as articulações com 1 dose por dia.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => {
                document.getElementById('kits')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="bg-[#E84A9A] text-white px-8 sm:px-10 py-5 sm:py-6 rounded-full font-bold text-base sm:text-lg shadow-2xl shadow-pink-200 hover:bg-[#6B2178] transition-all transform hover:scale-105 flex items-center justify-center gap-3 group mx-auto sm:mx-0"
            >
              QUERO MEU COLÁGENO TRI PLUS
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 pt-6 sm:pt-8 border-t border-[#F7EAF4] max-w-lg mx-auto">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-white overflow-hidden bg-gray-100">
                  <img src={`https://randomuser.me/api/portraits/women/${i + 10}.jpg`} alt="User" referrerPolicy="no-referrer" />
                </div>
              ))}
            </div>
            <div className="space-y-1 text-center sm:text-left">
              <div className="flex justify-center sm:justify-start text-[#E84A9A]">
                {[...Array(5)].map((_, i) => <Star key={i} size={14} fill="currentColor" stroke="none" />)}
              </div>
              <p className="text-[10px] sm:text-xs text-[#9B7594] font-medium">+15.000 pessoas transformando pele, cabelos e unhas</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  </section>
);

const Benefits = () => (
  <section id="beneficios" className="py-12 sm:py-20 bg-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-16 space-y-3 sm:space-y-4">
        <h2 className="text-2xl sm:text-4xl font-bold text-[#3F1848] tracking-tight">
          O que o Colágeno TRI PLUS faz por você?
        </h2>
        <p className="text-sm sm:text-base text-[#9B7594]">
          Uma fórmula completa com Verisol, tipos I, II e III e um complexo de vitaminas para beleza e mobilidade no dia a dia.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
        {[
          { icon: <Sparkles />, title: "Pele mais firme", desc: "Os peptídeos Verisol auxiliam na elasticidade e na redução da aparência de rugas com o uso diário contínuo." },
          { icon: <Droplets />, title: "Hidratação profunda", desc: "O ácido hialurônico contribui para reter água na pele, promovendo maciez, conforto e viço desde as primeiras semanas." },
          { icon: <Zap />, title: "Cabelos e unhas", desc: "Biotina, zinco, silício e selênio nutrem fios e unhas para mais resistência, brilho e menos quebra." },
          { icon: <CheckCircle2 />, title: "Articulações", desc: "O colágeno tipo II não desnaturado apoia cartilagem e mobilidade, especialmente para quem treina ou sente desgaste." },
        ].map((benefit, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="p-6 sm:p-8 rounded-2xl border border-[#F7EAF4] hover:border-[#E84A9A]/20 hover:shadow-xl transition-all group"
          >
            <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#F7EAF4] rounded-xl flex items-center justify-center text-[#E84A9A] mb-4 sm:mb-6 group-hover:bg-[#E84A9A] group-hover:text-white transition-colors">
              {benefit.icon}
            </div>
            <h3 className="text-lg sm:text-xl font-bold text-[#3F1848] mb-2 sm:mb-3">{benefit.title}</h3>
            <p className="text-[#9B7594] leading-relaxed text-xs sm:text-sm">{benefit.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

const Technology = () => (
  <section id="tecnologia" className="py-12 sm:py-20 bg-[#6B2178] text-white overflow-hidden">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 sm:gap-16 items-center">
      <motion.div
        initial={{ opacity: 0, x: -50 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
        className="space-y-6 sm:space-y-8 text-center lg:text-left"
      >
        <div className="space-y-3 sm:space-y-4">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-bold leading-tight">
            Três tipos de colágeno <br />
            <span className="text-[#F0B4D4]">em uma única dose diária.</span>
          </h2>
          <p className="text-[#F7EAF4]/80 text-base sm:text-lg leading-relaxed max-w-xl mx-auto lg:mx-0">
            O TRI PLUS reúne peptídeos Verisol (tipos I e III), colágeno tipo II não desnaturado 
            e ácido hialurônico, com coenzima Q10, silício orgânico, biotina e vitaminas A, C e E 
            para atuar em pele, cabelos, unhas e articulações.
          </p>
        </div>

        <div className="grid gap-4 sm:gap-6 text-left max-w-md mx-auto lg:mx-0">
          {[
            "Verisol® — peptídeos bioativos 2 kDa para pele, cabelos e unhas",
            "Colágeno tipo II — suporte à cartilagem e às articulações",
            "Ácido hialurônico + Q10 — hidratação e ação antioxidante",
            "1 porção ao dia · 30 doses por lata de 210 g"
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-3 sm:gap-4">
              <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={12} sm:size={14} className="text-white" />
              </div>
              <span className="text-sm sm:text-base font-medium text-[#F7EAF4]">{item}</span>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        className="relative px-4 sm:px-0"
      >
        <div className="rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border border-white/10">
          <img 
            src="/tri-plus-tecnologia.png" 
            alt="Colágeno TRI PLUS — 3 tipos de colágeno, Verisol, ácido hialurônico e complexo vitamínico" 
            className="w-full h-auto object-contain"
          />
        </div>
      </motion.div>
    </div>
  </section>
);

const Ingredients = () => (
  <section id="ingredientes" className="py-12 sm:py-20 bg-[#F7EAF4]/30">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="text-center max-w-3xl mx-auto mb-10 sm:mb-16 space-y-3 sm:space-y-4">
        <h2 className="text-2xl sm:text-4xl font-bold text-[#3F1848] tracking-tight">
          Uma fórmula estruturada para pele, fios e articulações
        </h2>
        <p className="text-sm sm:text-base text-[#9B7594]">
          Verisol, colágeno tipo II e ácido hialurônico em sinergia com vitaminas e minerais.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
        {[
          { name: "Verisol® (Tipos I e III)", desc: "Peptídeos bioativos de colágeno hidrolisado com peso molecular médio de 2 kDa. Associados à firmeza, elasticidade e redução da aparência de rugas, além do fortalecimento de cabelos e unhas." },
          { name: "Colágeno Tipo II", desc: "Colágeno de frango não desnaturado, componente da cartilagem. Contribui para lubrificação, amortecimento e conforto articular no dia a dia e na prática de exercícios." },
          { name: "Ácido Hialurônico + Complexo", desc: "100 mg de ácido hialurônico por porção, com coenzima Q10, silício orgânico, biotina, vitaminas A, C e E, zinco e selênio para hidratação, antioxidação e nutrição completa." },
        ].map((item, i) => (
          <div key={i} className="bg-white p-6 sm:p-8 rounded-2xl border border-[#F7EAF4] hover:shadow-lg transition-all">
            <h4 className="text-base sm:text-lg font-bold text-[#E84A9A] mb-2">{item.name}</h4>
            <p className="text-xs sm:text-sm text-[#9B7594] leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const KitBenefits = ({ items }: { items: string[] }) => (
  <ul className="w-full space-y-2.5 text-left px-1">
    {items.map((item, i) => (
      <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-[#9B7594] leading-snug">
        <CheckCircle2 size={16} className="text-[#E84A9A] flex-shrink-0 mt-0.5" />
        <span>{item}</span>
      </li>
    ))}
  </ul>
);

const Kits = ({ onAddToCart }: { onAddToCart: (kit: any) => void }) => (
  <section id="kits" className="py-12 sm:py-20 bg-white">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-10 sm:mb-16 space-y-3 sm:space-y-4">
        <h2 className="text-2xl sm:text-4xl font-bold text-[#3F1848] tracking-tight">
          Escolha seu Kit e Comece sua Transformação
        </h2>
        <p className="text-sm sm:text-base text-[#9B7594]">Economize comprando os kits de tratamento completo com Verisol.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 sm:gap-12 lg:gap-8 items-center">
        {/* Kit 1 */}
        <div className="border border-[#F7EAF4] rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-6 hover:shadow-xl transition-all">
          <p className="text-[10px] font-bold text-[#9B7594] uppercase tracking-widest">Tratamento 1 Mês</p>
          <div className="w-40 h-40 sm:w-48 sm:h-48 bg-[#F7EAF4] rounded-2xl overflow-hidden">
            <img src="/kit-1-unidade.jpg" alt="Kit 1 Unidade Colágeno TRI PLUS Body Action" className="w-full h-full object-contain" />
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-[#3F1848]">1 Unidade</h3>
          <div className="space-y-1">
            <p className="text-[#9B7594] line-through text-xs sm:text-sm">R$ 79,80</p>
            <p className="text-3xl sm:text-4xl font-bold text-[#3F1848]">R$ 39,90</p>
          </div>
          <KitBenefits items={[
            "Ideal para conhecer o Colágeno TRI PLUS",
            "30 porções · sabor manga com maracujá",
            "Frete grátis para todo o Brasil",
          ]} />
          <button onClick={() => onAddToCart({ id: 1, name: "1 Unidade", price: 39.90, image: "/kit-1-unidade.jpg" })} className="w-full py-4 bg-[#E84A9A] text-white rounded-full font-bold hover:bg-[#6B2178] transition-all text-sm sm:text-base">
            COMPRAR AGORA
          </button>
        </div>

        {/* Kit 3 - Popular */}
        <div className="border-2 border-[#E84A9A] rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-6 shadow-2xl relative sm:transform sm:scale-105 bg-white z-10">
          <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#E84A9A] text-white px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest">
            Mais Vendido
          </div>
          <p className="text-[10px] font-bold text-[#3F1848] uppercase tracking-widest">Tratamento 3 Meses</p>
          <div className="w-40 h-40 sm:w-48 sm:h-48 bg-[#F7EAF4] rounded-2xl overflow-hidden">
            <img src="/kit-3-unidades.png" alt="Kit 3 Unidades Colágeno TRI PLUS Body Action" className="w-full h-full object-contain" />
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-[#3F1848]">3 Unidades</h3>
          <div className="space-y-1">
            <p className="text-[#9B7594] line-through text-xs sm:text-sm">R$ 199,80</p>
            <p className="text-3xl sm:text-4xl font-bold text-[#3F1848]">R$ 79,90</p>
            <p className="text-xs sm:text-sm text-[#E84A9A] font-bold">50% de Desconto</p>
          </div>
          <KitBenefits items={[
            "Protocolo completo de 3 meses",
            "Pele, cabelos, unhas e articulações em manutenção",
            "Máxima economia para a rotina diária",
          ]} />
          <button onClick={() => onAddToCart({ id: 3, name: "3 Unidades", price: 79.90, image: "/kit-3-unidades.png" })} className="w-full py-4 bg-[#E84A9A] text-white rounded-full font-bold hover:bg-[#6B2178] transition-all shadow-lg shadow-pink-200 text-sm sm:text-base">
            APROVEITAR OFERTA
          </button>
        </div>

        {/* Kit 2 */}
        <div className="border border-[#F7EAF4] rounded-3xl p-6 sm:p-8 flex flex-col items-center text-center space-y-6 hover:shadow-xl transition-all">
          <p className="text-[10px] font-bold text-[#9B7594] uppercase tracking-widest">Tratamento 2 Meses</p>
          <div className="w-40 h-40 sm:w-48 sm:h-48 bg-[#F7EAF4] rounded-2xl overflow-hidden">
            <img src="/kit-2-unidades.png" alt="Kit 2 Unidades Colágeno TRI PLUS Body Action" className="w-full h-full object-contain" />
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-[#3F1848]">2 Unidades</h3>
          <div className="space-y-1">
            <p className="text-[#9B7594] line-through text-xs sm:text-sm">R$ 139,80</p>
            <p className="text-3xl sm:text-4xl font-bold text-[#3F1848]">R$ 59,90</p>
            <p className="text-xs sm:text-sm text-[#E84A9A] font-bold">Economia de R$ 79,90</p>
          </div>
          <KitBenefits items={[
            "2 meses de tratamento contínuo",
            "Firmeza da pele, fios e articulações em evolução",
            "Melhor custo-benefício para resultados visíveis",
          ]} />
          <button onClick={() => onAddToCart({ id: 2, name: "2 Unidades", price: 59.90, image: "/kit-2-unidades.png" })} className="w-full py-4 bg-[#E84A9A] text-white rounded-full font-bold hover:bg-[#6B2178] transition-all text-sm sm:text-base">
            COMPRAR AGORA
          </button>
        </div>
      </div>
    </div>
  </section>
);

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-12 sm:py-20 bg-[#F7EAF4]/30">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-4xl font-bold text-[#3F1848] text-center mb-10 sm:mb-16 tracking-tight">
          Dúvidas Frequentes
        </h2>
        
        <div className="space-y-3 sm:space-y-4">
          {[
            { q: "Em quanto tempo vejo resultados?", a: "Os primeiros sinais de hidratação e viço podem aparecer em poucas semanas. Para melhora visível de firmeza, cabelos, unhas e conforto articular, o uso contínuo de 30 a 90 dias (1 porção ao dia) é o mais indicado." },
            { q: "Para quem o Colágeno TRI PLUS é indicado?", a: "É indicado para maiores de 19 anos que buscam pele mais firme, cabelos e unhas fortalecidos e suporte às articulações. Homens e mulheres que treinam, sentem flacidez ou querem nutrir o colágeno de dentro para fora." },
            { q: "Como devo preparar o produto?", a: "Dilua 7 g (cerca de 3 dosadores cheios) em 100 ml de água ou bebida de sua preferência e mexa até dissolver. Pode ser consumido quente ou frio. Evite água fervente. Consuma 1 porção ao dia." },
            { q: "Tem glúten, lactose ou açúcar?", a: "Não contém glúten nem lactose. É adoçado com estévia. Pode conter leite e soja (traços de linha de produção). Não deve ser consumido por gestantes, lactantes e crianças." },
          ].map((item, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#F7EAF4] overflow-hidden">
              <button 
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full px-6 sm:px-8 py-5 sm:py-6 flex items-center justify-between text-left hover:bg-[#F7EAF4]/50 transition-colors"
              >
                <span className="font-bold text-[#3F1848] text-sm sm:text-base pr-4">{item.q}</span>
                <ChevronDown className={`text-[#E84A9A] transition-transform flex-shrink-0 ${openIndex === i ? 'rotate-180' : ''}`} size={20} />
              </button>
              <motion.div 
                initial={false}
                animate={{ height: openIndex === i ? 'auto' : 0, opacity: openIndex === i ? 1 : 0 }}
                className="overflow-hidden"
              >
                <div className="px-6 sm:px-8 pb-6 sm:pb-8 text-xs sm:text-sm text-[#9B7594] leading-relaxed">
                  {item.a}
                </div>
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const Footer = () => (
  <footer className="bg-white pt-12 sm:pt-20 pb-24 sm:pb-12 border-t border-[#F7EAF4]">
    <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 sm:gap-12 mb-12 sm:mb-16">
        <div className="space-y-4 sm:space-y-6 text-center sm:text-left">
          <div className="h-8 sm:h-10 bg-[#6B2178] px-3 rounded-lg flex items-center justify-center sm:justify-start mx-auto sm:mx-0 w-fit">
            <img 
              src="/logo-bodyaction.png" 
              alt="Body Action" 
              className="h-5 sm:h-7 w-auto object-contain"
            />
          </div>
          <p className="text-xs sm:text-sm text-[#9B7594] leading-relaxed">
            Colágeno TRI PLUS com Verisol, tipos I, II e III e ácido hialurônico para pele, cabelos, unhas e articulações.
          </p>
          <div className="flex justify-center sm:justify-start gap-4">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#F7EAF4] flex items-center justify-center text-[#E84A9A] hover:bg-[#E84A9A] hover:text-white transition-all cursor-pointer">
              <Instagram size={18} sm:size={20} />
            </div>
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-[#F7EAF4] flex items-center justify-center text-[#E84A9A] hover:bg-[#E84A9A] hover:text-white transition-all cursor-pointer">
              <Facebook size={18} sm:size={20} />
            </div>
          </div>
        </div>

        <div className="text-center sm:text-left">
          <h4 className="font-bold text-[#3F1848] mb-4 sm:mb-6 text-sm sm:text-base uppercase tracking-widest">Navegação</h4>
          <ul className="space-y-3 sm:space-y-4 text-xs sm:text-sm text-[#9B7594]">
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Início</li>
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Benefícios</li>
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Tecnologia</li>
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Kits</li>
          </ul>
        </div>

        <div className="text-center sm:text-left">
          <h4 className="font-bold text-[#3F1848] mb-4 sm:mb-6 text-sm sm:text-base uppercase tracking-widest">Suporte</h4>
          <ul className="space-y-3 sm:space-y-4 text-xs sm:text-sm text-[#9B7594]">
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Rastrear Pedido</li>
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Políticas de Envio</li>
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Trocas e Devoluções</li>
            <li className="hover:text-[#E84A9A] cursor-pointer transition-colors">Termos de Uso</li>
          </ul>
        </div>

        <div className="text-center sm:text-left">
          <h4 className="font-bold text-[#3F1848] mb-4 sm:mb-6 text-sm sm:text-base uppercase tracking-widest">Contato</h4>
          <ul className="space-y-3 sm:space-y-4 text-xs sm:text-sm text-[#9B7594]">
            <li className="flex items-center justify-center sm:justify-start gap-3">
              <Mail size={16} className="text-[#E84A9A]" />
              sac@rainha.ind.br
            </li>
            <li className="flex items-center justify-center sm:justify-start gap-3">
              <ShieldCheck size={16} className="text-[#E84A9A]" />
              Compra 100% Segura
            </li>
          </ul>
        </div>
      </div>

      <div className="pt-8 sm:pt-12 border-t border-[#F7EAF4] flex flex-col sm:flex-row justify-between items-center gap-6 sm:gap-8">
        <p className="text-[10px] sm:text-xs text-[#9B7594] text-center sm:text-left">
          © 2026 Body Action. Todos os direitos reservados. CNPJ: 02.400.660/0001-95
        </p>
        <div className="flex gap-4 sm:gap-6 opacity-50 grayscale hover:grayscale-0 transition-all">
          <CreditCard size={24} sm:size={32} />
          <div className="text-[10px] sm:text-xs font-bold text-[#3F1848]">VISA</div>
          <div className="text-[10px] sm:text-xs font-bold text-[#3F1848]">MASTERCARD</div>
          <div className="text-[10px] sm:text-xs font-bold text-[#3F1848]">PIX</div>
        </div>
      </div>
    </div>
  </footer>
);

// --- Main App ---

export default function App() {
  const [cartCount] = useState(0);

  useEffect(() => {
    const sync = () => {
      mergeUrlParamsFromLocation();
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  const handleAddToCart = (kitData: any) => {
    const qty = Number(kitData?.id) || 1;
    const stored = mergeUrlParamsFromLocation();
    const params = new URLSearchParams();
    Object.entries(stored).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set("qty", String(qty));
    window.location.href = `/checkout/?${params.toString()}`;
  };

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-[#E84A9A] selection:text-white">
      <AnnouncementBar />
      <Header cartCount={cartCount} />
      
      <main>
        <LandingHero />
        
        <section className="py-8 bg-white border-y border-[#F7EAF4]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-wrap justify-center items-center gap-8 sm:gap-16 opacity-40 grayscale">
            {["ANVISA", "SEM GLÚTEN", "SEM LACTOSE", "VERISOL®"].map((logo, i) => (
              <span key={i} className="text-[10px] sm:text-xs font-black tracking-widest uppercase text-[#3F1848]">{logo}</span>
            ))}
          </div>
        </section>

        <DarkHero />
        <SkinIssuesCarousel />

        <Benefits />
        <Technology />
        
        <section className="py-12 sm:py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 sm:gap-16 items-center">
            <div className="order-2 lg:order-1">
              <img 
                src="/tri-plus-mecanismo.png" 
                alt="Colágeno TRI PLUS — beleza de dentro para fora com tipos I, II e III" 
                className="w-full h-auto object-contain rounded-2xl sm:rounded-3xl shadow-2xl"
              />
            </div>
            <div className="order-1 lg:order-2 space-y-4 sm:space-y-6 text-center lg:text-left">
              <h2 className="text-2xl sm:text-4xl font-bold text-[#3F1848] tracking-tight">
                Por que esta fórmula funciona?
              </h2>
              <p className="text-sm sm:text-base text-[#9B7594] leading-relaxed">
                O Verisol é um peptídeo bioativo de baixo peso molecular, desenvolvido para atuar 
                na derme: favorece firmeza, elasticidade e a aparência de uma pele mais lisa.
              </p>
              <p className="text-sm sm:text-base text-[#9B7594] leading-relaxed">
                Combinado ao colágeno tipo II — que nutre a cartilagem — e ao ácido hialurônico, 
                que melhora a hidratação, o TRI PLUS atua em pele, cabelos, unhas e articulações 
                com uma única dose de 7 g por dia.
              </p>
            </div>
          </div>
        </section>

        <Ingredients />
        
        <section className="py-12 sm:py-20 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-12 sm:gap-16 items-center">
            <div className="space-y-6 sm:space-y-8 text-center lg:text-left">
              <h2 className="text-2xl sm:text-4xl font-bold text-[#3F1848] tracking-tight">Modo de Usar</h2>
              <div className="space-y-6 sm:space-y-8 text-left">
                {[
                  { step: "01", title: "Prepare", desc: "Separe 7 g, o equivalente a cerca de 3 dosadores cheios, uma vez ao dia." },
                  { step: "02", title: "Dilua", desc: "Coloque o pó em 100 ml de água gelada, suco ou bebida de sua preferência." },
                  { step: "03", title: "Misture", desc: "Mexa até dissolver por completo. Pode ser consumido quente ou frio, sem água fervente." },
                  { step: "04", title: "Consuma", desc: "Tome 1 porção diária. Cada lata de 210 g rende 30 doses para um mês de tratamento." },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 sm:gap-6">
                    <span className="text-3xl sm:text-4xl font-black text-[#F7EAF4] tabular-nums">{item.step}</span>
                    <div className="space-y-1">
                      <h4 className="font-bold text-[#3F1848] text-sm sm:text-base">{item.title}</h4>
                      <p className="text-xs sm:text-sm text-[#9B7594] leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative px-4 sm:px-0">
              <img 
                src="/tri-plus-modo-usar.png" 
                alt="Como usar o Colágeno TRI PLUS Body Action" 
                className="rounded-2xl sm:rounded-3xl shadow-2xl"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent rounded-2xl sm:rounded-3xl"></div>
            </div>
          </div>
        </section>

        <Kits onAddToCart={handleAddToCart} />

        <section className="py-20 bg-[#F7EAF4]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center space-y-8">
            <div className="w-20 h-20 bg-[#E84A9A] text-white rounded-full flex items-center justify-center mx-auto mb-8">
              <ShieldCheck size={40} />
            </div>
            <h2 className="text-3xl font-bold text-[#3F1848]">Garantia Blindada de 30 Dias</h2>
            <p className="text-[#9B7594] max-w-2xl mx-auto leading-relaxed">
              Temos tanta confiança na eficácia do Colágeno TRI PLUS que oferecemos uma garantia incondicional. 
              Se em 30 dias você não notar uma melhora visível na firmeza da pele, nos cabelos ou no bem-estar, 
              devolvemos 100% do seu dinheiro. Sem perguntas, sem burocracia.
            </p>
          </div>
        </section>

        <section className="py-20 bg-[#6B2178] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center space-y-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">O que dizem nossas clientes</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {[
                { name: "Mariana S.", text: "Minhas linhas finas diminuíram e a pele ficou bem mais firme. O sabor de manga com maracujá é delicioso!", location: "São Paulo, SP", images: ["/reviews/feedback-1.jpg", "/reviews/feedback-2.png"] },
                { name: "Carla R.", text: "Usei por 2 meses e as unhas pararam de quebrar. Sinto as articulações mais confortáveis no treino.", location: "Rio de Janeiro, RJ", images: ["/reviews/feedback-3.png", "/reviews/feedback-4.png"] },
                { name: "Patrícia L.", text: "Meu cabelo estava frágil e a pele opaca. O TRI PLUS devolveu o viço. Recomendo demais!", location: "Curitiba, PR", images: ["/reviews/feedback-5.png", "/reviews/feedback-6.png"] },
                { name: "Fernanda M.", text: "A pele ficou mais elástica e o copo diário virou hábito. Produto sério, dissolve bem e não tem gosto artificial.", location: "Belo Horizonte, MG", images: ["/reviews/feedback-7.png", "/reviews/feedback-8.png"] },
                { name: "Renata A.", text: "Comecei pelo kit de 2 unidades e notei diferença na firmeza e na hidratação da pele. Vou repetir o de 3 meses.", location: "Brasília, DF", images: ["/reviews/feedback-9.png", "/reviews/feedback-10.jpg"] },
              ].map((review, i) => (
                <div key={i} className="bg-white/5 p-8 rounded-2xl border border-white/10 text-left space-y-4">
                  <div className="flex text-[#E84A9A]">
                    {[...Array(5)].map((_, j) => <Star key={j} size={14} fill="currentColor" stroke="none" />)}
                  </div>
                  <p className="text-[#F7EAF4] italic leading-relaxed">"{review.text}"</p>
                  <div className="flex gap-2">
                    {review.images.map((src, j) => (
                      <img
                        key={j}
                        src={src}
                        alt={`Foto do produto enviada por ${review.name}`}
                        className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover border border-white/15 shadow-sm"
                      />
                    ))}
                  </div>
                  <div>
                    <p className="font-bold text-white">{review.name}</p>
                    <p className="text-xs text-[#F0B4D4]">{review.location}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        
        <FAQ />
      </main>

      <Footer />

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          display: flex;
          animation: marquee 30s linear infinite;
        }
      `}} />
    </div>
  );
}
