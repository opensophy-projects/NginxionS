 

#pragma once

namespace Waap {

class ResponseInspectReasons {
public:
    ResponseInspectReasons();
    bool shouldInspect() const;
    void setOpenRedirect(bool flag);
    void setErrorDisclosure(bool flag);
    void setRateLimiting(bool flag);
    void setErrorLimiter(bool flag);
    void setCollectResponseForLog(bool flag);
    void setApplyOverride(bool flag);

    bool getApplyOverride(void);
private:
    bool openRedirect;
    bool errorDisclosure;
    bool errorLimiter;
    bool rateLimiting;
    bool collectResponseForLog;
    bool applyOverride;
};

}
