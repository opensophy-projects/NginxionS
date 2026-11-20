 

#pragma once
#include "debug.h"
#include "WaapDecision.h"
#include "i_waapConfig.h"
#include <iostream>
#include <string>

USE_DEBUG_FLAG(D_WAAP);


namespace Waap {

namespace CSRF {

    class State
    {
    public:
        State();
        bool decide(
            const std::string &method,
            WaapDecision &decision,
            const std::shared_ptr<Waap::Csrf::Policy>& csrfPolicy) const;
        void injectCookieHeader(std::string& injectStr) const;
        void set_CsrfToken(const char* v, size_t v_len);
        void set_CsrfHeaderToken(const char* v, size_t v_len);
        void set_CsrfFormToken(const char* v, size_t v_len);
    private:
        std::string csrf_token;
        std::string csrf_header_token;
        std::string csrf_form_token;
    };

}
}
