 

#ifndef __VERSION_H__
#define __VERSION_H__

#include <string>

#include "i_rest_api.h"
#include "i_environment.h"
#include "singleton.h"

// get the current firewall version
class Version : Singleton::Consume<I_RestApi>, Singleton::Consume<I_Environment>
{
public:
    static void preload() {}

    static void init();
    static void fini() {}

    static std::string getName() { return "Version"; }

    static std::string get();
    static bool isPublic();
    static std::string getID();
    static std::string getUser();
    static std::string getTimestamp();
    static std::string getVerPrefix();
    static std::string getFullVersion();
    static std::string getBranch();
};

#endif // __VERSION_H__
