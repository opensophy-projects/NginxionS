 

#ifndef __WAAP_COMPONENT_IMPL_H__
#define __WAAP_COMPONENT_IMPL_H__

#include "waap.h"
#include "config.h"
#include "table_opaque.h"
#include "i_transaction.h"
#include "waap_clib/DeepAnalyzer.h"
#include "waap_clib/WaapAssetState.h"
#include "waap_clib/WaapAssetStatesManager.h"
#include "reputation_features_agg.h"

// WaapComponent implementation
class WaapComponent::Impl
        :
    public Listener<NewHttpTransactionEvent>,
    public Listener<HttpRequestHeaderEvent>,
    public Listener<HttpRequestBodyEvent>,
    public Listener<EndRequestEvent>,
    public Listener<ResponseCodeEvent>,
    public Listener<HttpResponseHeaderEvent>,
    public Listener<HttpResponseBodyEvent>,
    public Listener<EndTransactionEvent>
{
public:
    explicit Impl();
    virtual ~Impl();

    void init();
    void fini();

    std::string getListenerName() const override;

    EventVerdict respond(const NewHttpTransactionEvent &event) override;
    EventVerdict respond(const HttpRequestHeaderEvent &event) override;
    EventVerdict respond(const HttpRequestBodyEvent &event) override;
    EventVerdict respond(const EndRequestEvent &) override;

    EventVerdict respond(const ResponseCodeEvent &event) override;
    EventVerdict respond(const HttpResponseHeaderEvent &event) override;
    EventVerdict respond(const HttpResponseBodyEvent &event) override;
    EventVerdict respond(const EndTransactionEvent &) override;

private:

    void init(const std::string &waapDataFileName);
    EventVerdict waapDecisionAfterHeaders(IWaf2Transaction& waf2Transaction);
    EventVerdict waapDecision(IWaf2Transaction& waf2Transaction);
    void finishTransaction(IWaf2Transaction& waf2Transaction, EventVerdict& verdict);

    bool waf2_proc_start(const std::string& waapDataFileName);
    void waf2_proc_exit();
    void validateFirstRequestForAsset(const ReportIS::Severity severity);
    void sendNotificationForFirstRequest(
        const std::string& asset_id,
        const std::string& asset_name,
        const ReportIS::Severity severity
    );

    EventVerdict pending_response;
    EventVerdict accept_response;
    EventVerdict drop_response;
    EventVerdict limit_response_headers;
    WaapMetricWrapper waap_metric;
    AssetsMetric assets_metric;
    I_Table* waapStateTable;
    // Count of transactions processed by this WaapComponent instance
    uint64_t transactionsCount;
    // instance of singleton classes
    DeepAnalyzer deepAnalyzer;
    WaapAssetStatesManager waapAssetStatesManager;
    std::unordered_set<std::string> m_seen_assets_id;
};

#endif // __WAAP_COMPONENT_IMPL_H__
