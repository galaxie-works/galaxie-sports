import { defineMessages } from '../define';

/** Cosmos AI no painel do cliente: compra de créditos (#993); a tela completa vem no #995. */
export default defineMessages(
  {
    checkout: {
      productName: 'Cosmos AI · {name} ({credits} créditos)',
      errors: {
        forbidden: 'Sua sessão não abre o painel do cliente.',
        noTenant: 'Sua conta ainda não está ligada a um tenant.',
        notAllowed: 'Só quem administra a conta pode comprar créditos.',
        unknownPackage: 'Este pacote não está disponível para a sua conta. Escolha outro.',
        unavailable: 'A compra de créditos está indisponível agora. Tente de novo mais tarde.',
        generic: 'Não deu para abrir o pagamento. Tente de novo.',
        consentRequired: 'Para ligar a recarga automática, aceite a cobrança recorrente.',
        invalidThreshold: 'O limite para recarregar precisa ser maior que 0.',
      },
      pixReceipt:
        'No Pix, o extrato do banco mostra o nome do processador do pagamento, não Galaxie. O recibo chega por e-mail.',
    },
  },
  {
    en: {
      checkout: {
        productName: 'Cosmos AI · {name} ({credits} credits)',
        errors: {
          forbidden: 'Your session does not open the client panel.',
          noTenant: "Your account isn't linked to a tenant yet.",
          notAllowed: 'Only account admins can buy credits.',
          unknownPackage: "This package isn't available for your account. Pick another one.",
          unavailable: 'Buying credits is unavailable right now. Try again later.',
          generic: "We couldn't open the payment. Try again.",
          consentRequired: 'To turn on auto top-up, accept the recurring charge.',
          invalidThreshold: 'The top-up threshold must be greater than 0.',
        },
        pixReceipt:
          "With Pix, your bank statement shows the payment processor's name, not Galaxie. The receipt arrives by email.",
      },
    },
    'es-AR': {
      checkout: {
        productName: 'Cosmos AI · {name} ({credits} créditos)',
        errors: {
          forbidden: 'Tu sesión no abre el panel del cliente.',
          noTenant: 'Tu cuenta todavía no está vinculada a un tenant.',
          notAllowed: 'Solo quien administra la cuenta puede comprar créditos.',
          unknownPackage: 'Este paquete no está disponible para tu cuenta. Elegí otro.',
          unavailable: 'La compra de créditos no está disponible ahora. Probá de nuevo más tarde.',
          generic: 'No se pudo abrir el pago. Probá de nuevo.',
          consentRequired: 'Para activar la recarga automática, aceptá el cobro recurrente.',
          invalidThreshold: 'El límite para recargar tiene que ser mayor que 0.',
        },
        pixReceipt:
          'Con Pix, el extracto del banco muestra el nombre del procesador del pago, no Galaxie. El recibo llega por correo.',
      },
    },
  },
);
