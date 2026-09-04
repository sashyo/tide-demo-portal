/**
 * Forseti contract for Northside Clinic.
 *
 * Runs on the ORK network, not on our server. It decides who may decrypt clinical notes by
 * inspecting the caller's doken — so the answer does not come from a role column this app
 * owns, and changing anything in our database cannot alter it.
 *
 * Shape follows the pack's reference exactly. The notes below are the parts that do not
 * compile if you improvise:
 *   - all six `using` directives are required; `GetValue`/`TryGetValue` are extension methods
 *     in Cryptide.Tools and the ctx.Policy enums live in Ork.Shared.Models.Contracts
 *   - `ctx.Data` is a ReadOnlyMemory<byte> STRUCT, so `== null` is a compile error
 *   - tags start at index 2 for encryption and index 3 for decryption
 */
export const CLINIC_CONTRACT = `using Ork.Forseti.Sdk;
using Cryptide.Tools;
using Ork.Shared.Models.Contracts;
using System;
using System.Collections.Generic;
using System.Text;

public class Contract : IAccessPolicy
{
    [PolicyParam(Required = true)]
    public string Role { get; set; }

    private bool isEncryptionRequest = false;
    private List<string> DataTags = new();

    public PolicyDecision ValidateData(DataContext ctx)
    {
        if (ctx.RequestId == "PolicyEnabledEncryption:1")      isEncryptionRequest = true;
        else if (ctx.RequestId == "PolicyEnabledDecryption:1") isEncryptionRequest = false;
        else return PolicyDecision.Deny("This contract handles only encryption/decryption requests");

        if (ctx.Policy.ExecutionType != ExecutionType.PRIVATE)
            return PolicyDecision.Deny("Policy against this contract must be PRIVATE");

        ReadOnlyMemory<byte> data = ctx.Data;
        if (isEncryptionRequest)
        {
            var time  = data.GetValue(0);
            var first = data.GetValue(1);
            for (int i = 2; first.TryGetValue(i, out var tag); i++)
                DataTags.Add(Encoding.UTF8.GetString(tag.Span));
        }
        else
        {
            var first = data.GetValue(0);
            for (int i = 3; first.TryGetValue(i, out var tag); i++)
                DataTags.Add(Encoding.UTF8.GetString(tag.Span));
        }

        if (DataTags.Count == 0) return PolicyDecision.Deny("At least one data tag is required");
        return PolicyDecision.Allow();
    }

    public PolicyDecision ValidateExecutor(ExecutorContext ctx)
    {
        var executor = new DokenDto(ctx.Doken);
        return Decision
            .RequireNotExpired(executor)
            .RequireRole(executor, Role);
    }
}
`;

/** The realm role the contract checks. Reception does NOT have it; that is the whole demo. */
export const CONTRACT_ROLE = 'clinic-doctor';

/** Tag used on every encrypt/decrypt call for clinical notes. */
export const MEDICAL_TAG = 'medical';

/**
 * contractId is the SHA-512 of the EXACT source, uppercase hex. The ORK compares it
 * case-sensitively, and a lowercase hash fails with "Policy refers to wrong contract" — which
 * reads like the contract is missing rather than mis-cased.
 */
export async function computeContractId(source: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha512').update(source, 'utf8').digest('hex').toUpperCase();
}
