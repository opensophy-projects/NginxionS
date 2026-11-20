 

#ifndef __ENCRYPTOR_H__
#define __ENCRYPTOR_H__

#include <memory>

#include "i_encryptor.h"
#include "singleton.h"
#include "component.h"

class Encryptor : public Component, Singleton::Provide<I_Encryptor>
{
public:
    Encryptor();
    ~Encryptor();

    void preload();

private:
    class Impl;
    std::unique_ptr<Impl> pimpl;
};

#endif // __ENCRYPTOR_H__
