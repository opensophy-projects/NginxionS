 

#ifndef __INTELLIGENCE_REQUEST_H__
#define __INTELLIGENCE_REQUEST_H__
#include "intelligence_is_v2/query_request_v2.h"
#include "messaging/messaging_enums.h"
#include "messaging/messaging_metadata.h"

#include <vector>
#include "maybe_res.h"

namespace Intelligence {

class IntelligenceRequest : ClientRest
{
public:
    IntelligenceRequest(
        const std::vector<QueryRequest> &queries,
        bool is_pretty,
        bool is_bulk,
        bool _is_proxy,
        const MessageMetadata &req_md
    )
            :
        queries(queries), is_pretty(is_pretty), is_bulk(is_bulk), is_proxy(_is_proxy), req_md(req_md)
    {}

    Maybe<void> checkAssetsLimit() const;
    Maybe<void> checkMinConfidence() const;
    bool isPagingAllowed() const;
    bool isPagingActivated() const;
    Maybe<bool> isPagingFinished() const;
    Maybe<Intelligence_IS_V2::CursorState> getPagingStatus() const;
    Maybe<std::string> genJson() const;

    size_t getSize() const { return queries.size(); }
    bool isBulk() const { return is_bulk; }
    const MessageMetadata & getReqMD() const { return req_md; }

private:
    const std::vector<QueryRequest> &queries;
    bool is_pretty = true;
    bool is_bulk = false;
    bool is_proxy = false;
    Maybe<std::string> response_from_fog = genError("Uninitialized");
    const MessageMetadata &req_md;
};

}

#endif // __INTELLIGENCE_REQUEST_H__
