 

#include "lets_encrypt_listener.h"

#include <string>

#include "central_nginx_manager.h"
#include "debug.h"

using namespace std;

USE_DEBUG_FLAG(D_NGINX_MANAGER);

bool
LetsEncryptListener::init()
{
    dbgInfo(D_NGINX_MANAGER) << "Starting Lets Encrypt Listener";
    return Singleton::Consume<I_RestApi>::by<CentralNginxManager>()->addWildcardGetCall(
        ".well-known/acme-challenge/",
        [&] (const string &uri) -> string
        {
            Maybe<string> maybe_challenge_value = getChallengeValue(uri);
            if (!maybe_challenge_value.ok()) {
                dbgWarning(D_NGINX_MANAGER)
                    << "Could not get challenge value for uri: "
                    << uri
                    << ", error: "
                    << maybe_challenge_value.getErr();
                return string{""};
            };

            dbgTrace(D_NGINX_MANAGER) << "Got challenge value: " << maybe_challenge_value.unpack();
            return maybe_challenge_value.unpack();
        }
    );
}

Maybe<string>
LetsEncryptListener::getChallengeValue(const string &uri) const
{
    string challenge_key = uri.substr(uri.find_last_of('/') + 1);
    string api_query = "/api/lets-encrypt-challenge?http_challenge_key=" + challenge_key;

    dbgInfo(D_NGINX_MANAGER) << "Getting challenge value via: " << api_query;

    MessageMetadata md;
    md.insertHeader("X-Tenant-Id", Singleton::Consume<I_AgentDetails>::by<CentralNginxManager>()->getTenantId());
    Maybe<HTTPResponse, HTTPResponse> maybe_http_challenge_value =
        Singleton::Consume<I_Messaging>::by<CentralNginxManager>()->sendSyncMessage(
            HTTPMethod::GET,
            api_query,
            string("{}"),
            MessageCategory::GENERIC,
            md
        );

    if (!maybe_http_challenge_value.ok()) return genError(maybe_http_challenge_value.getErr().getBody());

    string challenge_value = maybe_http_challenge_value.unpack().getBody();
    if (!challenge_value.empty() && challenge_value.front() == '"' && challenge_value.back() == '"') {
        challenge_value = challenge_value.substr(1, challenge_value.size() - 2);
    }

    return challenge_value;
}
