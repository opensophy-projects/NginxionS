 

#ifndef __BASE64_H__
#define __BASE64_H__

#include <string>

class Base64
{
public:
    static std::string encodeBase64(const std::string &input);
    static std::string decodeBase64(const std::string &input);

private:
    static const std::string base64_base;
};

#endif // __BASE64_H__
