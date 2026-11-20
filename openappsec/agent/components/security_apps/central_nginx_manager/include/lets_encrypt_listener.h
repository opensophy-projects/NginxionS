 

#ifndef __LETS_ENCRYPT_HANDLER_H__
#define __LETS_ENCRYPT_HANDLER_H__

#include <string>

#include "maybe_res.h"

class LetsEncryptListener
{
public:
    bool init();

private:
    Maybe<std::string> getChallengeValue(const std::string &uri) const;
};

#endif // __LETS_ENCRYPT_HANDLER_H__
