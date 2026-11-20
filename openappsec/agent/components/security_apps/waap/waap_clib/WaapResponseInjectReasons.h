 

#pragma once

namespace Waap {

class ResponseInjectReasons {
public:
    ResponseInjectReasons();
    void clear();
    bool shouldInject() const;
    void setAntibot(bool flag);
    void setCaptcha(bool flag);
    void setCsrf(bool flag);
    void setSecurityHeaders(bool flag);
    bool shouldInjectAntibot() const;
    bool shouldInjectCaptcha() const;
    bool shouldInjectCsrf() const;
    bool shouldInjectSecurityHeaders() const;
private:
    bool csrf;
    bool antibot;
    bool captcha;
    bool securityHeaders;
};

}
