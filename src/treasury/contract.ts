/**
 * Forseti contract for approving a Northwind Treasury payment run.
 *
 * Runs on the ORK network. `ValidateApprovers` executes only under ApprovalType.EXPLICIT, and
 * that is the whole point: the quorum decision is taken on the network against the approvers'
 * dokens, not by this application deciding it liked a signature.
 *
 * Pre-flight PASSED (compile under both ctx.Data typings, sandbox scan, structure). Two errors
 * the harness caught first, both of which would have surfaced on the ORK as VmHost.CompileFailed
 * after an approval had already been spent:
 *   - ctx.Data.TryGetValue(...) needs a ReadOnlyMemory<byte> local — the extension is on that
 *     type, so a direct call fails under the byte[] typing (CS1929).
 *   - RequireAnyWithRole takes (approvers, resource, role); there is no two-argument form.
 */
export const PAYMENT_CONTRACT = `using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true)]
    public string Resource { get; set; }

    [PolicyParam(Required = true)]
    public string Role { get; set; }

    [PolicyParam(Required = true)]
    public string ExecutorRole { get; set; }

    public PolicyDecision ValidateData(DataContext ctx)
    {
        ReadOnlyMemory<byte> data = ctx.Data;
        if (!data.TryGetValue(0, out var _))
            return PolicyDecision.Deny("No payment payload supplied");
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateApprovers(ApproversContext ctx)
    {
        var approvers = DokenDto.WrapAll(ctx.Dokens);
        return Decision
            .RequireAnyWithRole(approvers, Resource, Role);
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, ExecutorRole);
    }
}
`;

/**
 * A custom Forseti model is identified by its WRAPPED name and version — the ORKs reject a bare
 * name with "not found in registry", and the policy must declare the full wrapped id.
 */
export const PAYMENT_REQUEST_NAME = 'BasicCustom<NorthwindPayment>';
export const PAYMENT_REQUEST_VERSION = 'BasicCustom<1>';
export const PAYMENT_MODEL_ID = `${PAYMENT_REQUEST_NAME}:${PAYMENT_REQUEST_VERSION}`;

/** Not a free choice: the ORKs expect this authorisation flow for a policy-governed request. */
export const PAYMENT_AUTH_FLOW = 'Policy:1';

/** Client role the APPROVERS must hold, checked by ValidateApprovers on the network. */
export const APPROVER_ROLE = 'payment-approver';

/** Realm role the party submitting the payment must hold, checked by ValidateExecutor. */
export const EXECUTOR_ROLE = 'treasury-controller';

/** Short on purpose: the request is created immediately before signing. */
export const REQUEST_EXPIRY_SECONDS = 60;

export async function computePaymentContractId(): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha512').update(PAYMENT_CONTRACT, 'utf8').digest('hex').toUpperCase();
}
