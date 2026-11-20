 

#include "WaapAssetState.h"
#include "waap.h"
#include <string>
#include <chrono>
#include <memory>
#include <cereal/types/vector.hpp>
#include <cereal/types/unordered_map.hpp>
#include <cereal/archives/json.hpp>
#include "ErrorLimiting.h"

namespace Waap
{
namespace ErrorLimiting
{

bool
ErrorLimiter::getErrorLimitingEnforcementStatus(){
    return m_errorLimiting.enable;
}

bool enforce(
    const std::string& sourceIdentifier,
    const std::string& uriStr,
    const std::shared_ptr<WaapAssetState>& pWaapAssetState,
    bool& log)
    {

    dbgTrace(D_WAAP) << "ErrorLimiting::enforce:: response code: 404 :: error Limiting.";

    // Get current clock time
    I_TimeGet* timer = Singleton::Consume<I_TimeGet>::by<WaapComponent>();

    // The error limiting state tracks error limiting information for all sources
    std::shared_ptr<Waap::RateLimiting::State> errorLimitingState = pWaapAssetState->getErrorLimitingState();

    std::chrono::seconds now = std::chrono::duration_cast<std::chrono::seconds>(timer->getMonotonicTime());
    if (errorLimitingState && (errorLimitingState->execute(sourceIdentifier, uriStr, now, log) == false)) {
        // block request due to error limiting
        return true;
    }

    return false;
}

}
}
