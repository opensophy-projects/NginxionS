/*! \file complex.hpp
    \brief Support for types found in \<complex\>
    \ingroup STLSupport */

#ifndef CEREAL_TYPES_COMPLEX_HPP_
#define CEREAL_TYPES_COMPLEX_HPP_

#include <complex>

namespace cereal
{
  //! Serializing (save) for std::complex
  template <class Archive, class T> inline
  void CEREAL_SAVE_FUNCTION_NAME( Archive & ar, std::complex<T> const & comp )
  {
    ar( CEREAL_NVP_("real", comp.real()),
        CEREAL_NVP_("imag", comp.imag()) );
  }

  //! Serializing (load) for std::complex
  template <class Archive, class T> inline
  void CEREAL_LOAD_FUNCTION_NAME( Archive & ar, std::complex<T> & bits )
  {
    T real, imag;
    ar( CEREAL_NVP_("real", real),
        CEREAL_NVP_("imag", imag) );
    bits = {real, imag};
  }
} // namespace cereal

#endif // CEREAL_TYPES_COMPLEX_HPP_
