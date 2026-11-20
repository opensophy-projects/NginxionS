 

#ifndef __I_ENCRYPTOR_H__
#define __I_ENCRYPTOR_H__

#include "maybe_res.h"

#include <string>
#include <memory>


static const std::string data1_file_name          = "data1.a";
static const std::string data4_file_name          = "data4.a";
static const std::string data6_file_name          = "data6.a";

static const std::string user_cred_file_name      = "data5.a";
static const std::string proxy_auth_file_name     = "data2.a";
static const std::string session_token_file_name  = "data3.a";

class I_Encryptor
{
public:

    // Base64
    virtual std::string base64Encode(const std::string &input) = 0;
    virtual std::string base64Decode(const std::string &input) = 0;

    // Obfuscating
    virtual std::string obfuscateXor(const std::string &input)          = 0;
    virtual std::string obfuscateXorBase64(const std::string &input)    = 0;


protected:
    virtual ~I_Encryptor() {}
};

#endif // __I_ENCRYPTOR_H__
