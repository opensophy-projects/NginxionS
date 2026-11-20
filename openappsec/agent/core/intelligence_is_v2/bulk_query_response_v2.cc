 

#include "intelligence_is_v2/bulk_query_response_v2.h"

using namespace std;

void
BulkResponseError::serialize(cereal::JSONInputArchive &ar)
{
    ar(
        cereal::make_nvp("index", index),
        cereal::make_nvp("statusCode", status_code),
        cereal::make_nvp("message", message)
    );
}

void
ValidBulkQueryResponse::serialize(cereal::JSONInputArchive &ar)
{
    ar(cereal::make_nvp("index", index), cereal::make_nvp("response", response));
}

void
IntelligenceQueryBulkResponse::serialize(cereal::JSONInputArchive &ar)
{
    ar(cereal::make_nvp("queriesResponse", valid_responses));
    try {
        ar(cereal::make_nvp("errors", errors));
    } catch (const cereal::Exception &e) {
        ar.setNextName(nullptr);
    }
}
