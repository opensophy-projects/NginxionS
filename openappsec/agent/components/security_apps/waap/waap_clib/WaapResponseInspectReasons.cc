 

#include "WaapResponseInspectReasons.h"
#include "debug.h"

USE_DEBUG_FLAG(D_WAAP);
USE_DEBUG_FLAG(D_OA_SCHEMA_UPDATER);

namespace Waap {

    ResponseInspectReasons::ResponseInspectReasons()
        :
    openRedirect(false),
    errorDisclosure(false),
    errorLimiter(false),
    rateLimiting(false),
    collectResponseForLog(false),
    applyOverride(false)
    {
    }

    bool
    ResponseInspectReasons::shouldInspect() const
    {
        dbgTrace(D_WAAP) << "ResponseInspectReasons::shouldInspect():" <<
            " OpenRedirect=" << openRedirect <<
            " ErrorDisclosure=" << errorDisclosure <<
            " RateLimiting=" << rateLimiting <<
            " ErrorLimiter=" << errorLimiter <<
            " collectResponseForLog=" << collectResponseForLog <<
            " applyOverride=" << applyOverride;

        return
            openRedirect || errorDisclosure || rateLimiting || errorLimiter ||
            collectResponseForLog || applyOverride;
    }

    void
    ResponseInspectReasons::setOpenRedirect(bool flag)
    {
        dbgTrace(D_WAAP) << "Change ResponseInspectReasons(OpenRedirect) " << openRedirect << " to " << flag;
        openRedirect = flag;
    }


    void
    ResponseInspectReasons::setErrorDisclosure(bool flag)
    {
        dbgTrace(D_WAAP) << "Change ResponseInspectReasons(ErrorDisclosure) " << errorDisclosure << " to " << flag;
        errorDisclosure = flag;
    }

    void
    ResponseInspectReasons::setRateLimiting(bool flag)
    {
        dbgTrace(D_WAAP) << "Change ResponseInspectReasons(RateLimiting) " << rateLimiting << " to " << flag;
        rateLimiting = flag;
    }

    void
    ResponseInspectReasons::setErrorLimiter(bool flag)
    {
        dbgTrace(D_WAAP) << "Change ResponseInspectReasons(ErrorLimiter) " << errorLimiter << " to " << flag;
        errorLimiter = flag;
    }

    void
    ResponseInspectReasons::setCollectResponseForLog(bool flag)
    {
        dbgTrace(D_WAAP) << "Change ResponseInspectReasons(collectResponseForLog) " << collectResponseForLog <<
        " to " << flag;
        collectResponseForLog = flag;
    }

    void
    ResponseInspectReasons::setApplyOverride(bool flag)
    {
        dbgTrace(D_WAAP) << "Change ResponseInspectReasons(setApplyOverride) " << applyOverride << " to " <<
            flag;
        applyOverride = flag;
    }

    bool
    ResponseInspectReasons::getApplyOverride(void)
    {
        return applyOverride;
    }

}
